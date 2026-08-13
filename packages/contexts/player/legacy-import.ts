import { createHash } from 'node:crypto'
import postgres from 'postgres'

const IMPORT_LOCK_KEY = 222_197_200
const DEFAULT_BATCH_SIZE = 10_000
const MANIFEST_VERSION = 1
const LEGACY_SOURCE = 'v2-legacy'
const EMPTY_CHECKSUM = createHash('sha256').update('').digest('hex')

type Sql = ReturnType<typeof postgres>
type RawRow = Record<string, unknown>
type SourceDatabaseRow = RawRow & {
  source_key: string
  brawlhalla_id: number | null
  raw_json: string
}
type SourceRow = {
  source_key: string
  brawlhalla_id: number | null
  raw_json: string
  raw_row: RawRow
}
type SourceDefinition = {
  table: string
  keyExpression: string
  playerOrder?: string
}
type SourceManifest = {
  version: typeof MANIFEST_VERSION
  rowCounts: Record<string, number>
  sourceRows: number
  sourceChecksum: string
}
type Reconciliation = {
  sourceRows: number
  archivedRows: number
  transformedRows: number
  unknownFacts: number
  rejectedRows: number
  historyRows: number
  sourceChecksum: string
  archiveChecksum: string
  semanticExact: boolean
  exact: boolean
}
export type LegacyPlayerImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: { stage: 'players'; sourceKey: string } | null
  reconciliation: Reconciliation
}
export type LegacyPlayerImportOptions = {
  batchSize?: number
  maxBatches?: number
  legacyWritersQuiesced?: true
}

type ProgressRow = {
  status: LegacyPlayerImportResult['status']
  last_player_id: number | null
  source_manifest: SourceManifest
  source_checksum: string
}

const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  { table: 'player', keyExpression: 'brawlhalla_id::text' },
  { table: 'player_alias', keyExpression: 'jsonb_build_array(brawlhalla_id, key)::text' },
  { table: 'player_stats_legend', keyExpression: 'jsonb_build_array(brawlhalla_id, legend_id)::text' },
  { table: 'player_weapon_stat', keyExpression: 'jsonb_build_array(brawlhalla_id, weapon)::text' },
  { table: 'player_ranked_legend', keyExpression: 'jsonb_build_array(brawlhalla_id, legend_id)::text' },
  {
    table: 'player_ranked_team',
    keyExpression: 'jsonb_build_array(brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, region)::text',
  },
  { table: 'rating_history', keyExpression: 'id::text', playerOrder: 'recorded_at, id' },
]

function sourceRowsSql(source: SourceDefinition, predicate = '', order: string | null = 'source_key'): string {
  return `SELECT source.*, ${source.keyExpression} AS source_key, to_jsonb(source)::text AS raw_json
    FROM public.${source.table} source ${predicate}${order ? ` ORDER BY ${order}` : ''}`
}

const PLAYER_RANKED_FIELDS = new Set([
  'region',
  'rating',
  'peak_rating',
  'tier',
  'ranked_games',
  'ranked_wins',
  'ranked_last_updated',
  'best_legend',
  'best_legend_games',
  'best_legend_wins',
  'synced_at_1v1',
  'valhallan_confirmed_at',
])
const PLAYER_THREE_V_THREE_FIELDS = new Set([
  'rating_3v3',
  'peak_rating_3v3',
  'tier_3v3',
  'wins_3v3',
  'losses_3v3',
  'synced_at_3v3',
])
const PLAYER_CAREER_FIELDS = new Set([
  'xp',
  'level',
  'xp_percentage',
  'total_games',
  'total_wins',
  'match_time_total',
  'damage_bomb',
  'damage_mine',
  'damage_spikeball',
  'damage_sidekick',
  'hit_snowball',
  'ko_bomb',
  'ko_mine',
  'ko_spikeball',
  'ko_sidekick',
  'ko_snowball',
  'stats_last_updated',
])
const PLAYER_DEFAULT_ZERO_FIELDS = new Set([
  'rating',
  'peak_rating',
  'ranked_games',
  'ranked_wins',
  'best_legend',
  'best_legend_games',
  'best_legend_wins',
  'rating_3v3',
  'peak_rating_3v3',
  'wins_3v3',
  'losses_3v3',
  'match_time_total',
  'view_count',
])
const AMBIGUOUS_CHILD_TABLES = new Set(['player_stats_legend', 'player_weapon_stat'])
const PLAYER_SWEEPED_1V1_FIELDS = new Set([
  'region',
  'rating',
  'peak_rating',
  'tier',
  'ranked_games',
  'ranked_wins',
  'valhallan_confirmed_at',
])
const HISTORY_ZERO_PROOF_FIELDS = new Map([
  ['peak_rating', 'peak_rating'],
  ['ranked_games', 'games'],
  ['ranked_wins', 'wins'],
])
const ID_FIELDS = new Set(['id', 'brawlhalla_id', 'brawlhalla_id_one', 'brawlhalla_id_two', 'legend_id'])

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function addChecksumFrame(hash: ReturnType<typeof createHash>, table: string, key: string, rowChecksum: string): void {
  hash.update(`${table.length}:${table}${key.length}:${key}${rowChecksum}`)
}

function visibleText(value: unknown, maximum = Number.POSITIVE_INFINITY): value is string {
  return typeof value === 'string' && [...value].length <= maximum && /[^\p{Separator}\p{Format}]/u.test(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function parseLegacyTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const explicit = /(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(explicit)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function scopeFor(sourceTable: string, factKey: string, raw: RawRow): string {
  if (sourceTable === 'player') {
    if (factKey === 'brawlhalla_id' || factKey === 'name') return 'identity'
    if (PLAYER_RANKED_FIELDS.has(factKey)) return 'current-season:1v1'
    if (PLAYER_THREE_V_THREE_FIELDS.has(factKey)) return 'current-season:3v3'
    if (PLAYER_CAREER_FIELDS.has(factKey)) return 'career'
    return 'operational'
  }
  if (sourceTable === 'player_alias') return 'identity'
  if (sourceTable === 'player_stats_legend' || sourceTable === 'player_weapon_stat') return 'career'
  if (sourceTable === 'player_ranked_team') {
    return raw.brawlhalla_id_two === 0 ? 'current-season:solo-2v2' : 'current-season:fixed-2v2'
  }
  if (sourceTable === 'player_ranked_legend') return 'current-season:1v1'
  return 'current-season:rating-history'
}

function latestTimestamp(left: unknown, right: unknown): Date | null {
  const leftTimestamp = parseLegacyTimestamp(left)
  const rightTimestamp = parseLegacyTimestamp(right)
  if (!leftTimestamp) return rightTimestamp
  if (!rightTimestamp) return leftTimestamp
  return leftTimestamp > rightTimestamp ? leftTimestamp : rightTimestamp
}

function observedAtFor(sourceTable: string, factKey: string, raw: RawRow, player: RawRow): Date | null {
  if (sourceTable === 'rating_history') return parseLegacyTimestamp(raw.recorded_at)
  if (sourceTable === 'player_alias') return parseLegacyTimestamp(raw.created_at)
  if (sourceTable === 'player_ranked_team') {
    return parseLegacyTimestamp(raw.synced_at) ?? parseLegacyTimestamp(player.ranked_last_updated)
  }
  if (sourceTable === 'player_ranked_legend') return parseLegacyTimestamp(player.ranked_last_updated)
  if (sourceTable === 'player_stats_legend' || sourceTable === 'player_weapon_stat') {
    return parseLegacyTimestamp(player.stats_last_updated)
  }
  if (PLAYER_SWEEPED_1V1_FIELDS.has(factKey)) {
    return latestTimestamp(raw.ranked_last_updated, raw.synced_at_1v1)
  }
  if (PLAYER_RANKED_FIELDS.has(factKey)) return parseLegacyTimestamp(raw.ranked_last_updated)
  if (PLAYER_THREE_V_THREE_FIELDS.has(factKey)) return parseLegacyTimestamp(raw.synced_at_3v3)
  if (PLAYER_CAREER_FIELDS.has(factKey)) return parseLegacyTimestamp(raw.stats_last_updated)
  return parseLegacyTimestamp(raw.last_updated)
}

function playerZeroHasIndependentProof(
  factKey: string,
  value: unknown,
  raw: RawRow,
  latestHistory: RawRow | null,
): boolean {
  const historyField = HISTORY_ZERO_PROOF_FIELDS.get(factKey)
  if (historyField && latestHistory?.[historyField] === value) return true
  if (PLAYER_SWEEPED_1V1_FIELDS.has(factKey)) return parseLegacyTimestamp(raw.synced_at_1v1) !== null
  if (PLAYER_THREE_V_THREE_FIELDS.has(factKey)) return parseLegacyTimestamp(raw.synced_at_3v3) !== null
  return false
}

function isAmbiguousZero(
  sourceTable: string,
  factKey: string,
  value: unknown,
  raw: RawRow,
  latestHistory: RawRow | null,
): boolean {
  if (value !== 0 && value !== '0') return false
  if (sourceTable === 'rating_history' || ID_FIELDS.has(factKey)) return false
  if (sourceTable !== 'player') return AMBIGUOUS_CHILD_TABLES.has(sourceTable)
  if (!PLAYER_DEFAULT_ZERO_FIELDS.has(factKey)) return false
  return !playerZeroHasIndependentProof(factKey, value, raw, latestHistory)
}

function unwrapRawJson(rawJson: string): string {
  if (!rawJson.startsWith('"')) return rawJson
  try {
    const unwrapped: unknown = JSON.parse(rawJson)
    if (typeof unwrapped !== 'string') throw new Error('Legacy raw JSON wrapper must contain text')
    return unwrapped
  } catch (error) {
    throw new Error('Legacy raw JSON wrapper is invalid', { cause: error })
  }
}

function normalizeSourceRow(row: SourceDatabaseRow): SourceRow {
  const rawJson = unwrapRawJson(row.raw_json)
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson) as unknown
  } catch (error) {
    throw new Error(`Legacy source row ${row.source_key} contains invalid JSON`, { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Legacy source row ${row.source_key} is not a JSON object`)
  }
  return {
    source_key: row.source_key,
    brawlhalla_id: (row.brawlhalla_id as number | null) ?? null,
    raw_json: rawJson,
    raw_row: parsed as RawRow,
  }
}

function checksumRawJson(rawJson: string): string {
  return createHash('sha256').update(rawJson, 'utf8').digest('hex')
}

async function computeSourceManifest(client: Sql): Promise<SourceManifest> {
  const hash = createHash('sha256')
  const rowCounts: Record<string, number> = {}
  let sourceRows = 0
  for (const source of SOURCE_DEFINITIONS) {
    let count = 0
    for await (const rows of client.unsafe<SourceDatabaseRow[]>(sourceRowsSql(source)).cursor(1_000)) {
      for (const databaseRow of rows) {
        const row = normalizeSourceRow(databaseRow)
        addChecksumFrame(hash, source.table, row.source_key, checksumRawJson(row.raw_json))
        count += 1
      }
    }
    rowCounts[source.table] = count
    sourceRows += count
  }
  return { version: MANIFEST_VERSION, rowCounts, sourceRows, sourceChecksum: hash.digest('hex') }
}

async function sourceArchiveExact(client: Sql): Promise<boolean> {
  for (const source of SOURCE_DEFINITIONS) {
    const [comparison] = await client.unsafe<Array<{ exact: boolean }>>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM (${sourceRowsSql(source, '', null)}) current_source
         FULL JOIN (
           SELECT source_key, raw_row, row_checksum
           FROM players.legacy_archive WHERE source_table = $1
         ) archive USING (source_key)
         WHERE current_source.source_key IS NULL
            OR archive.source_key IS NULL
            OR current_source.raw_json::jsonb IS DISTINCT FROM archive.raw_row
            OR archive.row_checksum <> encode(sha256(convert_to(current_source.raw_json, 'UTF8')), 'hex')
       ) AS exact`,
      [source.table],
    )
    if (!comparison?.exact) return false
  }
  return true
}

async function archiveRows(sql: Sql, sourceTable: string, rows: SourceRow[]): Promise<Map<string, string>> {
  const checksums = new Map(rows.map((row) => [row.source_key, checksumRawJson(row.raw_json)]))
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const chunk = rows.slice(offset, offset + 1_000)
    const sourceKeys = chunk.map((row) => row.source_key)
    const playerIds = chunk.map((row) => row.brawlhalla_id)
    const rawRows = chunk.map((row) => row.raw_json)
    const rowChecksums = chunk.map((row) => checksums.get(row.source_key) as string)
    await sql`
      INSERT INTO players.legacy_archive
        (source_table, source_key, brawlhalla_id, raw_row, row_checksum, content_checksum)
      SELECT ${sourceTable}, incoming.source_key, incoming.brawlhalla_id, incoming.raw_json::jsonb,
             incoming.row_checksum, encode(sha256(convert_to(incoming.raw_json::jsonb::text, 'UTF8')), 'hex')
      FROM unnest(${sourceKeys}::text[], ${playerIds}::integer[], ${rawRows}::text[], ${rowChecksums}::text[])
        AS incoming(source_key, brawlhalla_id, raw_json, row_checksum)
      ON CONFLICT DO NOTHING
    `
    const [conflict] = await sql<{ source_key: string; row_type: string | null }[]>`
      SELECT incoming.source_key, jsonb_typeof(archive.raw_row) AS row_type
      FROM unnest(${sourceKeys}::text[], ${rawRows}::text[], ${rowChecksums}::text[])
        AS incoming(source_key, raw_json, row_checksum)
      LEFT JOIN players.legacy_archive archive
        ON archive.source_table = ${sourceTable} AND archive.source_key = incoming.source_key
      WHERE archive.source_key IS NULL
         OR archive.row_checksum <> incoming.row_checksum
         OR archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
         OR archive.raw_row IS DISTINCT FROM incoming.raw_json::jsonb
         OR jsonb_typeof(archive.raw_row) <> 'object'
      LIMIT 1
    `
    if (conflict) {
      throw new Error(
        conflict.row_type && conflict.row_type !== 'object'
          ? `Legacy raw archive row ${sourceTable}/${conflict.source_key} is ${conflict.row_type}, not an object`
          : `Legacy source mutation detected for ${sourceTable}/${conflict.source_key}`,
      )
    }
  }
  return checksums
}

type FactInput = {
  sourceTable: string
  sourceKey: string
  brawlhallaId: number | null
  factKey: string
  scope: string
  observedAt: string | null
  outcome: 'known' | 'unknown'
  reason: string | null
  provenance: string
  archiveChecksum: string
}
type RejectionInput = {
  sourceTable: string
  sourceKey: string
  code: string
  evidence: string
  archiveChecksum: string
}
type LedgerInput = {
  sourceTable: string
  sourceKey: string
  archiveChecksum: string
  outcome: 'transformed' | 'rejected'
}

function factsForRow(
  sourceTable: string,
  row: SourceRow,
  player: RawRow,
  archiveChecksum: string,
  latestHistory: RawRow | null,
): FactInput[] {
  return Object.entries(row.raw_row)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([factKey, rawValue]) => {
      const ambiguousZero = isAmbiguousZero(sourceTable, factKey, rawValue, row.raw_row, latestHistory)
      const unknown = rawValue === null || rawValue === undefined || ambiguousZero
      const scope = scopeFor(sourceTable, factKey, row.raw_row)
      const observedAt = observedAtFor(sourceTable, factKey, row.raw_row, player)?.toISOString() ?? null
      const outcome = unknown ? ('unknown' as const) : ('known' as const)
      const reason = ambiguousZero ? 'legacy-default-zero-unproven' : unknown ? 'legacy-source-null' : null
      return {
        sourceTable,
        sourceKey: row.source_key,
        brawlhallaId: row.brawlhalla_id,
        factKey,
        scope,
        observedAt,
        outcome,
        reason,
        provenance: stableJson({
          source: LEGACY_SOURCE,
          sourceTable,
          sourceKey: row.source_key,
          archiveChecksum,
          scope,
          outcome,
          reason,
          legacyTimestamp: observedAt,
          ...(ambiguousZero ? { rawValue, proof: 'unproven-default' } : {}),
          ...(sourceTable === 'rating_history' && (rawValue === 0 || rawValue === '0')
            ? { proof: 'dedicated-history-observation' }
            : {}),
        }),
        archiveChecksum,
      }
    })
}

async function insertFacts(sql: Sql, facts: FactInput[]): Promise<void> {
  for (let offset = 0; offset < facts.length; offset += 10_000) {
    const chunk = facts.slice(offset, offset + 10_000)
    await sql`
      WITH incoming AS (
        SELECT * FROM unnest(
          ${chunk.map((fact) => fact.sourceTable)}::text[],
          ${chunk.map((fact) => fact.sourceKey)}::text[],
          ${chunk.map((fact) => fact.brawlhallaId)}::integer[],
          ${chunk.map((fact) => fact.factKey)}::text[],
          ${chunk.map((fact) => fact.scope)}::text[],
          ${chunk.map((fact) => fact.observedAt)}::text[],
          ${chunk.map((fact) => fact.outcome)}::text[],
          ${chunk.map((fact) => fact.reason)}::text[],
          ${chunk.map((fact) => fact.provenance)}::text[],
          ${chunk.map((fact) => fact.archiveChecksum)}::text[]
        ) AS fact(source_table, source_key, brawlhalla_id, fact_key, scope, observed_at,
                  outcome, reason, provenance, archive_checksum)
      )
      INSERT INTO players.legacy_facts
        (source_table, source_key, fact_key, brawlhalla_id, scope, source, observed_at,
         value, outcome, reason, provenance, archive_checksum)
      SELECT incoming.source_table, incoming.source_key, incoming.fact_key, incoming.brawlhalla_id,
             incoming.scope, 'v2-legacy', incoming.observed_at::timestamptz,
             CASE WHEN incoming.outcome = 'known' THEN raw_fact.value ELSE NULL END,
             incoming.outcome, incoming.reason, incoming.provenance::jsonb, incoming.archive_checksum
      FROM incoming
      JOIN players.legacy_archive archive
        ON archive.source_table = incoming.source_table AND archive.source_key = incoming.source_key
      CROSS JOIN LATERAL jsonb_each(archive.raw_row) raw_fact
      WHERE raw_fact.key = incoming.fact_key
      ON CONFLICT DO NOTHING
    `
  }
}

async function insertRejections(sql: Sql, rejections: RejectionInput[]): Promise<void> {
  if (rejections.length === 0) return
  await sql`
    INSERT INTO players.legacy_import_rejections
      (source_table, source_key, code, evidence, archive_checksum)
    SELECT rejection.source_table, rejection.source_key, rejection.code,
           rejection.evidence::jsonb, rejection.archive_checksum
    FROM unnest(
      ${rejections.map((item) => item.sourceTable)}::text[],
      ${rejections.map((item) => item.sourceKey)}::text[],
      ${rejections.map((item) => item.code)}::text[],
      ${rejections.map((item) => item.evidence)}::text[],
      ${rejections.map((item) => item.archiveChecksum)}::text[]
    ) AS rejection(source_table, source_key, code, evidence, archive_checksum)
    ON CONFLICT DO NOTHING
  `
}

async function insertLedger(sql: Sql, ledger: LedgerInput[]): Promise<void> {
  if (ledger.length === 0) return
  await sql`
    INSERT INTO players.legacy_import_ledger (source_table, source_key, archive_checksum, outcome)
    SELECT * FROM unnest(
      ${ledger.map((item) => item.sourceTable)}::text[],
      ${ledger.map((item) => item.sourceKey)}::text[],
      ${ledger.map((item) => item.archiveChecksum)}::text[],
      ${ledger.map((item) => item.outcome)}::text[]
    ) AS evidence(source_table, source_key, archive_checksum, outcome)
    ON CONFLICT DO NOTHING
  `
}

async function readBatchRows(sql: Sql, brawlhallaIds: number[]): Promise<Map<string, SourceRow[]>> {
  const entries = await Promise.all(
    SOURCE_DEFINITIONS.slice(1).map(async (source) => {
      const rows = await sql.unsafe<SourceDatabaseRow[]>(
        sourceRowsSql(source, 'WHERE brawlhalla_id = ANY($1::integer[])', source.playerOrder),
        [brawlhallaIds],
      )
      return [source.table, rows.map(normalizeSourceRow)] as const
    }),
  )
  return new Map(entries)
}

function historyRejection(raw: RawRow): string | null {
  if (!positiveInteger(raw.brawlhalla_id)) return 'history-player-identity-invalid'
  if (!positiveInteger(raw.rating)) return 'history-rating-invalid'
  if (!nonNegativeInteger(raw.peak_rating)) return 'history-peak-rating-invalid'
  if (!visibleText(raw.tier, 64)) return 'history-tier-unavailable'
  if (!nonNegativeInteger(raw.games) || !nonNegativeInteger(raw.wins)) return 'history-record-invalid'
  if (!parseLegacyTimestamp(raw.recorded_at)) return 'history-timestamp-invalid'
  if (!Number.isSafeInteger(raw.id)) return 'history-order-invalid'
  return null
}

type HistoryInput = {
  row: SourceRow
  archiveChecksum: string
  brawlhallaId: number
  rating: number
  peakRating: number
  tier: string
  wins: number
  games: number
  recordedAt: string
  sourceOrder: number
}
type ProfileInput = {
  row: SourceRow
  archiveChecksum: string
  brawlhallaId: number
  playerName: string
  region: string | null
  rating: number | null
  viewCount: number
  observedAt: string
}
type AliasInput = {
  row: SourceRow
  archiveChecksum: string
  brawlhallaId: number
  normalizedAlias: string
  displayAlias: string
  observedAt: string
}

async function insertHistories(sql: Sql, histories: HistoryInput[]): Promise<void> {
  if (histories.length === 0) return
  await sql`
    INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at)
    SELECT DISTINCT ON (history.brawlhalla_id) history.brawlhalla_id, history.recorded_at::timestamptz
    FROM unnest(
      ${histories.map((item) => item.brawlhallaId)}::integer[],
      ${histories.map((item) => item.recordedAt)}::text[],
      ${histories.map((item) => item.sourceOrder)}::bigint[]
    ) AS history(brawlhalla_id, recorded_at, source_order)
    ORDER BY history.brawlhalla_id, history.recorded_at::timestamptz, history.source_order
    ON CONFLICT DO NOTHING
  `
  await sql`
    INSERT INTO players.ranked_rating_history
      (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at,
       history_source, legacy_source_key, source_order)
    SELECT history.brawlhalla_id, history.rating, history.peak_rating, history.tier,
           history.wins, history.games, history.recorded_at::timestamptz,
           'v2-legacy', history.source_key, history.source_order
    FROM unnest(
      ${histories.map((item) => item.brawlhallaId)}::integer[],
      ${histories.map((item) => item.rating)}::integer[],
      ${histories.map((item) => item.peakRating)}::integer[],
      ${histories.map((item) => item.tier)}::text[],
      ${histories.map((item) => item.wins)}::integer[],
      ${histories.map((item) => item.games)}::integer[],
      ${histories.map((item) => item.recordedAt)}::text[],
      ${histories.map((item) => item.row.source_key)}::text[],
      ${histories.map((item) => item.sourceOrder)}::bigint[]
    ) AS history(brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at, source_key, source_order)
    ON CONFLICT DO NOTHING
  `
}

async function insertProfiles(sql: Sql, profiles: ProfileInput[]): Promise<void> {
  if (profiles.length === 0) return
  await sql`
    INSERT INTO players.legacy_discovery_profiles
      (brawlhalla_id, player_name, region, rating, view_count, observed_at, archive_checksum)
    SELECT * FROM unnest(
      ${profiles.map((item) => item.brawlhallaId)}::integer[],
      ${profiles.map((item) => item.playerName)}::text[],
      ${profiles.map((item) => item.region)}::text[],
      ${profiles.map((item) => item.rating)}::integer[],
      ${profiles.map((item) => item.viewCount)}::integer[],
      ${profiles.map((item) => item.observedAt)}::timestamptz[],
      ${profiles.map((item) => item.archiveChecksum)}::text[]
    ) AS profile(brawlhalla_id, player_name, region, rating, view_count, observed_at, archive_checksum)
    ON CONFLICT DO NOTHING
  `
}

async function insertAliases(sql: Sql, aliases: AliasInput[]): Promise<void> {
  if (aliases.length === 0) return
  await sql`
    INSERT INTO players.legacy_discovery_aliases
      (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
    SELECT * FROM unnest(
      ${aliases.map((item) => item.brawlhallaId)}::integer[],
      ${aliases.map((item) => item.normalizedAlias)}::text[],
      ${aliases.map((item) => item.displayAlias)}::text[],
      ${aliases.map((item) => item.observedAt)}::timestamptz[],
      ${aliases.map((item) => item.archiveChecksum)}::text[]
    ) AS alias(brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
    ON CONFLICT DO NOTHING
  `
}

async function enqueueDiscoveryBatch(sql: Sql, brawlhallaIds: number[]): Promise<void> {
  const identities = [...new Set(brawlhallaIds.filter(positiveInteger))]
  if (identities.length === 0) return
  const [state] = await sql<{ source_version: string }[]>`
    UPDATE players.discovery_state
    SET source_version = source_version + 1
    WHERE singleton
    RETURNING source_version
  `
  if (!state) throw new Error('Players Discovery state singleton is missing')
  await sql`
    INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
    SELECT identity, ${state.source_version}::bigint FROM unnest(${identities}::integer[]) AS identity
  `
}

async function importPlayerBatch(sql: Sql, players: SourceRow[]): Promise<void> {
  const playerIds = players.map((player) => player.brawlhalla_id).filter((id): id is number => id !== null)
  const playerById = new Map(players.map((player) => [player.brawlhalla_id, player]))
  const related = await readBatchRows(sql, playerIds)
  const historiesByPlayer = new Map<number, SourceRow[]>()
  for (const history of related.get('rating_history') ?? []) {
    if (history.brawlhalla_id === null) continue
    const rows = historiesByPlayer.get(history.brawlhalla_id) ?? []
    rows.push(history)
    historiesByPlayer.set(history.brawlhalla_id, rows)
  }

  const checksumByTable = new Map<string, Map<string, string>>()
  checksumByTable.set('player', await archiveRows(sql, 'player', players))
  for (const [sourceTable, rows] of related) {
    checksumByTable.set(sourceTable, await archiveRows(sql, sourceTable, rows))
  }

  const facts: FactInput[] = []
  const rejections: RejectionInput[] = []
  const ledger: LedgerInput[] = []
  const profiles: ProfileInput[] = []
  const aliases: AliasInput[] = []
  const histories: HistoryInput[] = []

  for (const player of players) {
    const checksum = checksumByTable.get('player')?.get(player.source_key)
    if (!checksum) throw new Error(`Player archive checksum is missing for ${player.source_key}`)
    const latestHistory =
      player.brawlhalla_id === null ? null : (historiesByPlayer.get(player.brawlhalla_id)?.at(-1)?.raw_row ?? null)
    facts.push(...factsForRow('player', player, player.raw_row, checksum, latestHistory))
    const raw = player.raw_row
    const observedAt = parseLegacyTimestamp(raw.last_updated)
    const valid = positiveInteger(raw.brawlhalla_id) && visibleText(raw.name, 256) && observedAt !== null
    if (valid) {
      profiles.push({
        row: player,
        archiveChecksum: checksum,
        brawlhallaId: raw.brawlhalla_id as number,
        playerName: raw.name as string,
        region: typeof raw.region === 'string' ? raw.region : null,
        rating: positiveInteger(raw.rating) ? raw.rating : null,
        viewCount: nonNegativeInteger(raw.view_count) ? raw.view_count : 0,
        observedAt: (observedAt as Date).toISOString(),
      })
    } else {
      rejections.push({
        sourceTable: 'player',
        sourceKey: player.source_key,
        code: 'player-identity-invalid',
        evidence: stableJson({ brawlhallaId: raw.brawlhalla_id, name: raw.name, lastUpdated: raw.last_updated }),
        archiveChecksum: checksum,
      })
    }
    ledger.push({
      sourceTable: 'player',
      sourceKey: player.source_key,
      archiveChecksum: checksum,
      outcome: valid ? 'transformed' : 'rejected',
    })
  }

  for (const [sourceTable, rows] of related) {
    for (const row of rows) {
      const checksum = checksumByTable.get(sourceTable)?.get(row.source_key)
      const player = playerById.get(row.brawlhalla_id)
      if (!checksum || !player)
        throw new Error(`Player batch relation is incomplete for ${sourceTable}/${row.source_key}`)
      const latestHistory =
        row.brawlhalla_id === null ? null : (historiesByPlayer.get(row.brawlhalla_id)?.at(-1)?.raw_row ?? null)
      facts.push(...factsForRow(sourceTable, row, player.raw_row, checksum, latestHistory))
      let outcome: LedgerInput['outcome'] = 'transformed'
      if (sourceTable === 'rating_history') {
        const code = historyRejection(row.raw_row)
        if (code) {
          outcome = 'rejected'
          rejections.push({
            sourceTable,
            sourceKey: row.source_key,
            code,
            evidence: stableJson({ rawRow: row.raw_row }),
            archiveChecksum: checksum,
          })
        } else {
          const raw = row.raw_row
          histories.push({
            row,
            archiveChecksum: checksum,
            brawlhallaId: raw.brawlhalla_id as number,
            rating: raw.rating as number,
            peakRating: raw.peak_rating as number,
            tier: raw.tier as string,
            wins: raw.wins as number,
            games: raw.games as number,
            recordedAt: (parseLegacyTimestamp(raw.recorded_at) as Date).toISOString(),
            sourceOrder: raw.id as number,
          })
        }
      } else if (sourceTable === 'player_alias') {
        const raw = row.raw_row
        const observedAt = parseLegacyTimestamp(raw.created_at)
        if (!positiveInteger(raw.brawlhalla_id) || !visibleText(raw.value, 256) || !observedAt) {
          outcome = 'rejected'
          rejections.push({
            sourceTable,
            sourceKey: row.source_key,
            code: 'alias-identity-invalid',
            evidence: stableJson({ rawRow: raw }),
            archiveChecksum: checksum,
          })
        } else {
          aliases.push({
            row,
            archiveChecksum: checksum,
            brawlhallaId: raw.brawlhalla_id,
            normalizedAlias: raw.value.toLowerCase(),
            displayAlias: raw.value,
            observedAt: observedAt.toISOString(),
          })
        }
      }
      ledger.push({ sourceTable, sourceKey: row.source_key, archiveChecksum: checksum, outcome })
    }
  }

  await insertFacts(sql, facts)
  await insertProfiles(sql, profiles)
  await insertHistories(sql, histories)
  await insertAliases(sql, aliases)

  if (aliases.length > 0) {
    const existingAliases = await sql<
      Array<{ brawlhalla_id: number; normalized_alias: string; display_alias: string; archive_checksum: string }>
    >`
      SELECT destination.brawlhalla_id, destination.normalized_alias,
             destination.display_alias, destination.archive_checksum
      FROM players.legacy_discovery_aliases destination
      JOIN unnest(
        ${aliases.map((alias) => alias.brawlhallaId)}::integer[],
        ${aliases.map((alias) => alias.normalizedAlias)}::text[]
      ) AS incoming(brawlhalla_id, normalized_alias)
        USING (brawlhalla_id, normalized_alias)
    `
    const existingByIdentity = new Map(
      existingAliases.map((alias) => [`${alias.brawlhalla_id}:${alias.normalized_alias}`, alias]),
    )
    for (const alias of aliases) {
      const existing = existingByIdentity.get(`${alias.brawlhallaId}:${alias.normalizedAlias}`)
      if (
        existing?.display_alias === alias.displayAlias &&
        existing.archive_checksum.trim() === alias.archiveChecksum
      ) {
        continue
      }
      const item = ledger.find(
        (entry) => entry.sourceTable === 'player_alias' && entry.sourceKey === alias.row.source_key,
      )
      if (item) item.outcome = 'rejected'
      rejections.push({
        sourceTable: 'player_alias',
        sourceKey: alias.row.source_key,
        code: 'alias-normalization-collision',
        evidence: stableJson({ rawRow: alias.row.raw_row, existing }),
        archiveChecksum: alias.archiveChecksum,
      })
    }
  }

  await insertRejections(sql, rejections)
  await insertLedger(sql, ledger)
}

async function reconcile(client: Sql, manifest: SourceManifest): Promise<Reconciliation> {
  const archiveHash = createHash('sha256')
  let archivedRows = 0
  for (const source of SOURCE_DEFINITIONS) {
    for await (const rows of client<
      Array<{ source_key: string; row_checksum: string }>
    >`SELECT source_key, row_checksum FROM players.legacy_archive
       WHERE source_table = ${source.table} ORDER BY source_key`.cursor(1_000)) {
      for (const row of rows) {
        addChecksumFrame(archiveHash, source.table, row.source_key, row.row_checksum.trim())
        archivedRows += 1
      }
    }
  }
  const archiveChecksum = archivedRows === 0 ? EMPTY_CHECKSUM : archiveHash.digest('hex')
  const archiveMatchesSource = await sourceArchiveExact(client)
  const [counts] = await client<
    Array<{ transformed: number; rejected: number; unknown: number; history: number; semantic_exact: boolean }>
  >`
    SELECT
      (SELECT count(*)::integer FROM players.legacy_import_ledger WHERE outcome = 'transformed') AS transformed,
      (SELECT count(*)::integer FROM players.legacy_import_ledger WHERE outcome = 'rejected') AS rejected,
      (SELECT count(*)::integer FROM players.legacy_facts WHERE outcome = 'unknown') AS unknown,
      (SELECT count(*)::integer FROM players.ranked_rating_history WHERE history_source = 'v2-legacy') AS history,
      NOT EXISTS (
        SELECT 1
        FROM players.legacy_archive archive
        CROSS JOIN LATERAL jsonb_each(archive.raw_row) raw_fact
        LEFT JOIN players.legacy_facts fact
          ON fact.source_table = archive.source_table
         AND fact.source_key = archive.source_key
         AND fact.fact_key = raw_fact.key
        WHERE archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
           OR fact.fact_key IS NULL
           OR fact.archive_checksum <> archive.row_checksum
           OR fact.source <> 'v2-legacy'
           OR fact.scope IS DISTINCT FROM fact.provenance->>'scope'
           OR fact.outcome IS DISTINCT FROM fact.provenance->>'outcome'
           OR fact.reason IS DISTINCT FROM fact.provenance->>'reason'
           OR fact.observed_at IS DISTINCT FROM (fact.provenance->>'legacyTimestamp')::timestamptz
           OR fact.provenance->>'source' <> 'v2-legacy'
           OR fact.provenance->>'sourceTable' IS DISTINCT FROM archive.source_table
           OR fact.provenance->>'sourceKey' IS DISTINCT FROM archive.source_key
           OR fact.provenance->>'archiveChecksum' IS DISTINCT FROM archive.row_checksum
           OR (fact.outcome = 'known' AND fact.value IS DISTINCT FROM raw_fact.value)
           OR (fact.outcome = 'unknown' AND fact.value IS NOT NULL)
           OR (raw_fact.value = 'null'::jsonb AND fact.outcome <> 'unknown')
           OR (raw_fact.value <> 'null'::jsonb AND raw_fact.value <> '0'::jsonb AND fact.outcome <> 'known')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_facts fact
        JOIN players.legacy_archive archive
          ON archive.source_table = fact.source_table AND archive.source_key = fact.source_key
        WHERE NOT (archive.raw_row ? fact.fact_key)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_import_ledger ledger
        JOIN players.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN players.ranked_rating_history history
          ON history.history_source = 'v2-legacy' AND history.legacy_source_key = archive.source_key
        WHERE ledger.source_table = 'rating_history'
          AND ledger.outcome = 'transformed'
          AND (
            history.id IS NULL
            OR history.brawlhalla_id::text <> archive.raw_row->>'brawlhalla_id'
            OR history.rating::text <> archive.raw_row->>'rating'
            OR history.peak_rating::text <> archive.raw_row->>'peak_rating'
            OR history.tier <> archive.raw_row->>'tier'
            OR history.wins::text <> archive.raw_row->>'wins'
            OR history.games::text <> archive.raw_row->>'games'
            OR history.source_order::text <> archive.raw_row->>'id'
            OR history.recorded_at <> ((archive.raw_row->>'recorded_at')::timestamp AT TIME ZONE 'UTC')
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_import_ledger ledger
        JOIN players.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN players.legacy_discovery_profiles profile
          ON profile.brawlhalla_id = archive.brawlhalla_id
        WHERE ledger.source_table = 'player'
          AND ledger.outcome = 'transformed'
          AND (
            profile.brawlhalla_id IS NULL
            OR profile.player_name IS DISTINCT FROM archive.raw_row->>'name'
            OR profile.region IS DISTINCT FROM archive.raw_row->>'region'
            OR profile.rating IS DISTINCT FROM CASE
              WHEN (archive.raw_row->>'rating')::bigint > 0 THEN (archive.raw_row->>'rating')::integer
              ELSE NULL
            END
            OR profile.view_count IS DISTINCT FROM CASE
              WHEN (archive.raw_row->>'view_count')::bigint >= 0 THEN (archive.raw_row->>'view_count')::integer
              ELSE 0
            END
            OR profile.observed_at <> ((archive.raw_row->>'last_updated')::timestamp AT TIME ZONE 'UTC')
            OR profile.archive_checksum <> archive.row_checksum
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_import_ledger ledger
        JOIN players.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN players.legacy_discovery_aliases alias
          ON alias.brawlhalla_id = archive.brawlhalla_id
         AND alias.normalized_alias = lower(archive.raw_row->>'value')
        WHERE ledger.source_table = 'player_alias'
          AND ledger.outcome = 'transformed'
          AND (
            alias.brawlhalla_id IS NULL
            OR alias.display_alias IS DISTINCT FROM archive.raw_row->>'value'
            OR alias.observed_at <> ((archive.raw_row->>'created_at')::timestamp AT TIME ZONE 'UTC')
            OR alias.archive_checksum <> archive.row_checksum
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM players.legacy_import_ledger ledger
        WHERE ledger.outcome = 'rejected'
          AND (
            SELECT count(*) <> 1 OR bool_or(rejection.archive_checksum <> ledger.archive_checksum)
            FROM players.legacy_import_rejections rejection
            WHERE rejection.source_table = ledger.source_table AND rejection.source_key = ledger.source_key
          )
      ) AS semantic_exact
  `
  const semanticExact = archiveMatchesSource && counts.semantic_exact
  const exact =
    manifest.sourceRows === archivedRows &&
    manifest.sourceRows === counts.transformed + counts.rejected &&
    manifest.sourceChecksum === archiveChecksum &&
    semanticExact
  return {
    sourceRows: manifest.sourceRows,
    archivedRows,
    transformedRows: counts.transformed,
    unknownFacts: counts.unknown,
    rejectedRows: counts.rejected,
    historyRows: counts.history,
    sourceChecksum: manifest.sourceChecksum,
    archiveChecksum,
    semanticExact,
    exact,
  }
}

function validateOptions(options: LegacyPlayerImportOptions): {
  batchSize: number
  maxBatches: number
  legacyWritersQuiesced: boolean
} {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Player import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Player import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches, legacyWritersQuiesced: options.legacyWritersQuiesced === true }
}

async function lockPlayerSourcesAndReadManifest(sql: Sql): Promise<SourceManifest> {
  await sql.unsafe(
    'LOCK TABLE public.player, public.player_alias, public.player_stats_legend, public.player_weapon_stat, public.player_ranked_legend, public.player_ranked_team, public.rating_history IN SHARE MODE',
  )
  return computeSourceManifest(sql)
}

export async function importLegacyPlayers(
  connectionString: string,
  options: LegacyPlayerImportOptions = {},
): Promise<LegacyPlayerImportResult> {
  const { batchSize, maxBatches, legacyWritersQuiesced } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client.unsafe('SET statement_timeout = 30000')
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    await client.unsafe('SET statement_timeout = 0')

    const manifest = await client.begin(async (transaction) =>
      lockPlayerSourcesAndReadManifest(transaction as unknown as Sql),
    )
    let [progress] = await client<ProgressRow[]>`
      SELECT status, last_player_id, source_manifest, source_checksum
      FROM players.legacy_import_progress WHERE singleton
    `
    if (!progress) {
      ;[progress] = await client<ProgressRow[]>`
        INSERT INTO players.legacy_import_progress
          (status, stage, source_manifest, source_checksum)
        VALUES
          ('in-progress', 'players', ${client.json(manifest)}, ${manifest.sourceChecksum})
        RETURNING status, last_player_id, source_manifest, source_checksum
      `
    } else if (
      progress.source_checksum.trim() !== manifest.sourceChecksum ||
      stableJson(progress.source_manifest) !== stableJson(manifest)
    ) {
      await client`
        UPDATE players.legacy_import_progress
        SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
        WHERE singleton
      `
      await insertRejections(client, [
        {
          sourceTable: 'manifest',
          sourceKey: manifest.sourceChecksum,
          code: 'source-manifest-changed',
          evidence: stableJson({ frozen: progress.source_manifest, current: manifest }),
          archiveChecksum: manifest.sourceChecksum,
        },
      ])
      return {
        status: 'blocked',
        checkpoint:
          progress.last_player_id === null ? null : { stage: 'players', sourceKey: String(progress.last_player_id) },
        reconciliation: await reconcile(client, manifest),
      }
    }

    let cursor = progress.last_player_id
    let batches = 0
    let completed = progress.status === 'complete'
    while (!completed && batches < maxBatches) {
      const playerSource = SOURCE_DEFINITIONS[0]
      if (!playerSource || playerSource.table !== 'player') throw new Error('Legacy player source registry is invalid')
      const batch = await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!legacyWritersQuiesced) {
          const currentManifest = await lockPlayerSourcesAndReadManifest(sql)
          if (stableJson(currentManifest) !== stableJson(progress.source_manifest)) {
            return { outcome: 'source-changed' as const, currentManifest }
          }
        }
        const playerRows = await sql.unsafe<SourceDatabaseRow[]>(
          `${sourceRowsSql(
            playerSource,
            'WHERE ($1::integer IS NULL OR brawlhalla_id > $1::integer)',
            'brawlhalla_id',
          )} LIMIT $2`,
          [cursor, batchSize],
        )
        const players = playerRows.map(normalizeSourceRow)
        if (players.length === 0) {
          await sql`
            UPDATE players.legacy_import_progress
            SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE singleton
          `
          return { outcome: 'complete' as const }
        }
        await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
        await importPlayerBatch(sql, players)
        await enqueueDiscoveryBatch(sql, players.map((player) => player.brawlhalla_id).filter(positiveInteger))
        const nextCursor = players.at(-1)?.brawlhalla_id ?? null
        await sql`
          UPDATE players.legacy_import_progress
          SET status = 'in-progress', last_player_id = ${nextCursor}, updated_at = clock_timestamp()
          WHERE singleton
        `
        return { outcome: 'archived' as const, cursor: nextCursor }
      })
      if (batch.outcome === 'source-changed') {
        await client`
          UPDATE players.legacy_import_progress
          SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
          WHERE singleton
        `
        await insertRejections(client, [
          {
            sourceTable: 'manifest',
            sourceKey: batch.currentManifest.sourceChecksum,
            code: 'source-manifest-changed',
            evidence: stableJson({ frozen: progress.source_manifest, current: batch.currentManifest }),
            archiveChecksum: batch.currentManifest.sourceChecksum,
          },
        ])
        return {
          status: 'blocked',
          checkpoint: cursor === null ? null : { stage: 'players', sourceKey: String(cursor) },
          reconciliation: await reconcile(client, batch.currentManifest),
        }
      }
      if (batch.outcome === 'complete') {
        completed = true
        break
      }
      cursor = batch.cursor
      batches += 1
    }

    const reconciliation = await reconcile(client, manifest)
    if (completed && !reconciliation.exact) {
      await client`
        UPDATE players.legacy_import_progress
        SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
        WHERE singleton
      `
      return {
        status: 'blocked',
        checkpoint: cursor === null ? null : { stage: 'players', sourceKey: String(cursor) },
        reconciliation,
      }
    }
    return {
      status: completed ? 'complete' : 'in-progress',
      checkpoint: completed || cursor === null ? null : { stage: 'players', sourceKey: String(cursor) },
      reconciliation,
    }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
