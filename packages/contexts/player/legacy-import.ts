import { createHash } from 'node:crypto'
import postgres from 'postgres'

const IMPORT_LOCK_KEY = 222_197_200
const DEFAULT_BATCH_SIZE = 500
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

async function archiveRow(sql: Sql, sourceTable: string, row: SourceRow): Promise<string> {
  const rowChecksum = checksumRawJson(row.raw_json)
  await sql.unsafe(
    `INSERT INTO players.legacy_archive
      (source_table, source_key, brawlhalla_id, raw_row, row_checksum, content_checksum)
     VALUES ($1, $2, $3, $4::text::jsonb, $5,
       encode(sha256(convert_to(($4::text::jsonb)::text, 'UTF8')), 'hex'))
     ON CONFLICT DO NOTHING`,
    [sourceTable, row.source_key, row.brawlhalla_id, row.raw_json, rowChecksum],
  )
  const [archived] = await sql<
    Array<{ row_checksum: string; row_type: string; content_valid: boolean; source_valid: boolean }>
  >`
    SELECT row_checksum, jsonb_typeof(raw_row) AS row_type,
      content_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex') AS content_valid,
      raw_row = ${row.raw_json}::text::jsonb AS source_valid
    FROM players.legacy_archive
    WHERE source_table = ${sourceTable} AND source_key = ${row.source_key}
  `
  if (!archived || archived.row_checksum.trim() !== rowChecksum || !archived.content_valid || !archived.source_valid) {
    throw new Error(`Legacy source mutation detected for ${sourceTable}/${row.source_key}`)
  }
  if (archived.row_type !== 'object') {
    throw new Error(`Legacy raw archive row ${sourceTable}/${row.source_key} is ${archived.row_type}, not an object`)
  }
  return rowChecksum
}

async function recordFacts(
  sql: Sql,
  sourceTable: string,
  row: SourceRow,
  player: RawRow,
  archiveChecksum: string,
  latestHistory: RawRow | null,
): Promise<void> {
  const facts = Object.entries(row.raw_row)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([factKey, rawValue]) => {
      const ambiguousZero = isAmbiguousZero(sourceTable, factKey, rawValue, row.raw_row, latestHistory)
      const unknown = rawValue === null || rawValue === undefined || ambiguousZero
      const scope = scopeFor(sourceTable, factKey, row.raw_row)
      const observedAt = observedAtFor(sourceTable, factKey, row.raw_row, player)
      const observedAtIso = observedAt?.toISOString() ?? null
      const outcome = unknown ? 'unknown' : 'known'
      const reason = ambiguousZero ? 'legacy-default-zero-unproven' : unknown ? 'legacy-source-null' : null
      return {
        factKey,
        scope,
        observedAt: observedAtIso,
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
          legacyTimestamp: observedAtIso,
          ...(ambiguousZero ? { rawValue, proof: 'unproven-default' } : {}),
          ...(sourceTable === 'rating_history' && (rawValue === 0 || rawValue === '0')
            ? { proof: 'dedicated-history-observation' }
            : {}),
        }),
      }
    })
  if (facts.length === 0) return

  const parameters: Array<string | number | null> = [sourceTable, row.source_key, row.brawlhalla_id, archiveChecksum]
  const values = facts.map((fact, index) => {
    const offset = 5 + index * 6
    parameters.push(fact.factKey, fact.scope, fact.observedAt, fact.outcome, fact.reason, fact.provenance)
    return `($${offset}, $${offset + 1}, $${offset + 2}::timestamptz, $${offset + 3}, $${offset + 4}, $${offset + 5}::text::jsonb)`
  })
  await sql.unsafe(
    `WITH incoming (fact_key, scope, observed_at, outcome, reason, provenance) AS (
       VALUES ${values.join(', ')}
     )
     INSERT INTO players.legacy_facts
       (source_table, source_key, fact_key, brawlhalla_id, scope, source, observed_at,
        value, outcome, reason, provenance, archive_checksum)
     SELECT $1, $2, incoming.fact_key, $3, incoming.scope, 'v2-legacy', incoming.observed_at,
            CASE WHEN incoming.outcome = 'known' THEN raw_fact.value ELSE NULL END,
            incoming.outcome, incoming.reason, incoming.provenance, $4
     FROM players.legacy_archive archive
     CROSS JOIN LATERAL jsonb_each(archive.raw_row) raw_fact
     JOIN incoming ON incoming.fact_key::text = raw_fact.key
     WHERE archive.source_table = $1 AND archive.source_key = $2
     ON CONFLICT DO NOTHING`,
    parameters,
  )
}

async function reject(
  sql: Sql,
  sourceTable: string,
  sourceKey: string,
  code: string,
  evidence: unknown,
  archiveChecksum: string,
): Promise<void> {
  await sql`
    INSERT INTO players.legacy_import_rejections
      (source_table, source_key, code, evidence, archive_checksum)
    VALUES (${sourceTable}, ${sourceKey}, ${code}, ${sql.json(evidence as never)}, ${archiveChecksum})
    ON CONFLICT DO NOTHING
  `
}

async function finishLedger(
  sql: Sql,
  sourceTable: string,
  sourceKey: string,
  archiveChecksum: string,
  outcome: 'transformed' | 'rejected',
): Promise<void> {
  await sql`
    INSERT INTO players.legacy_import_ledger
      (source_table, source_key, archive_checksum, outcome)
    VALUES (${sourceTable}, ${sourceKey}, ${archiveChecksum}, ${outcome})
    ON CONFLICT DO NOTHING
  `
}

async function readPlayerRows(sql: Sql, brawlhallaId: number): Promise<Map<string, SourceRow[]>> {
  const relatedSources = SOURCE_DEFINITIONS.filter(({ table }) => table !== 'player')
  const entries = await Promise.all(
    relatedSources.map(async (source) => {
      const rows = await sql.unsafe<SourceDatabaseRow[]>(
        sourceRowsSql(source, 'WHERE brawlhalla_id = $1', source.playerOrder),
        [brawlhallaId],
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

async function importHistory(sql: Sql, row: SourceRow, archiveChecksum: string): Promise<'transformed' | 'rejected'> {
  const code = historyRejection(row.raw_row)
  if (code) {
    await reject(sql, 'rating_history', row.source_key, code, { rawRow: row.raw_row }, archiveChecksum)
    return 'rejected'
  }
  const raw = row.raw_row
  const recordedAt = parseLegacyTimestamp(raw.recorded_at) as Date
  await sql`
    INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at)
    VALUES (${raw.brawlhalla_id as number}, ${recordedAt.toISOString()}::timestamptz)
    ON CONFLICT DO NOTHING
  `
  await sql`
    INSERT INTO players.ranked_rating_history
      (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at,
       history_source, legacy_source_key, source_order)
    VALUES
      (${raw.brawlhalla_id as number}, ${raw.rating as number}, ${raw.peak_rating as number},
       ${raw.tier as string}, ${raw.wins as number}, ${raw.games as number},
       ${recordedAt.toISOString()}::timestamptz, 'v2-legacy', ${row.source_key}, ${raw.id as number})
    ON CONFLICT DO NOTHING
  `
  return 'transformed'
}

async function importDiscoveryProfile(
  sql: Sql,
  playerRow: SourceRow,
  archiveChecksum: string,
): Promise<'transformed' | 'rejected'> {
  const raw = playerRow.raw_row
  const observedAt = parseLegacyTimestamp(raw.last_updated)
  if (!positiveInteger(raw.brawlhalla_id) || !visibleText(raw.name, 256) || !observedAt) {
    await reject(
      sql,
      'player',
      playerRow.source_key,
      'player-identity-invalid',
      { brawlhallaId: raw.brawlhalla_id, name: raw.name, lastUpdated: raw.last_updated },
      archiveChecksum,
    )
    return 'rejected'
  }
  const rating = positiveInteger(raw.rating) ? raw.rating : null
  const viewCount = nonNegativeInteger(raw.view_count) ? raw.view_count : 0
  await sql`
    INSERT INTO players.legacy_discovery_profiles
      (brawlhalla_id, player_name, region, rating, view_count, observed_at, archive_checksum)
    VALUES
      (${raw.brawlhalla_id}, ${raw.name}, ${typeof raw.region === 'string' ? raw.region : null},
       ${rating}, ${viewCount}, ${observedAt.toISOString()}::timestamptz, ${archiveChecksum})
    ON CONFLICT DO NOTHING
  `
  return 'transformed'
}

async function importAlias(sql: Sql, row: SourceRow, archiveChecksum: string): Promise<'transformed' | 'rejected'> {
  const raw = row.raw_row
  const observedAt = parseLegacyTimestamp(raw.created_at)
  if (!positiveInteger(raw.brawlhalla_id) || !visibleText(raw.value, 256) || !observedAt) {
    await reject(sql, 'player_alias', row.source_key, 'alias-identity-invalid', { rawRow: raw }, archiveChecksum)
    return 'rejected'
  }
  const normalized = raw.value.toLowerCase()
  const inserted = await sql<{ display_alias: string; archive_checksum: string }[]>`
    INSERT INTO players.legacy_discovery_aliases
      (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
    VALUES
      (${raw.brawlhalla_id}, ${normalized}, ${raw.value}, ${observedAt.toISOString()}::timestamptz,
       ${archiveChecksum})
    ON CONFLICT DO NOTHING
    RETURNING display_alias, archive_checksum
  `
  if (inserted.length > 0) return 'transformed'

  const [existing] = await sql<{ display_alias: string; archive_checksum: string }[]>`
    SELECT display_alias, archive_checksum
    FROM players.legacy_discovery_aliases
    WHERE brawlhalla_id = ${raw.brawlhalla_id} AND normalized_alias = ${normalized}
  `
  if (existing?.display_alias === raw.value && existing.archive_checksum.trim() === archiveChecksum) {
    return 'transformed'
  }
  await reject(
    sql,
    'player_alias',
    row.source_key,
    'alias-normalization-collision',
    { rawRow: raw, existing },
    archiveChecksum,
  )
  return 'rejected'
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

async function importPlayer(sql: Sql, playerRow: SourceRow): Promise<void> {
  if (playerRow.brawlhalla_id === null) throw new Error(`Player source ${playerRow.source_key} has no identity`)
  const related = await readPlayerRows(sql, playerRow.brawlhalla_id)
  const histories = related.get('rating_history') ?? []
  const latestHistory = histories.at(-1)?.raw_row ?? null
  const playerChecksum = await archiveRow(sql, 'player', playerRow)
  await recordFacts(sql, 'player', playerRow, playerRow.raw_row, playerChecksum, latestHistory)
  const playerOutcome = await importDiscoveryProfile(sql, playerRow, playerChecksum)
  await finishLedger(sql, 'player', playerRow.source_key, playerChecksum, playerOutcome)

  for (const [sourceTable, rows] of related) {
    for (const row of rows) {
      const archiveChecksum = await archiveRow(sql, sourceTable, row)
      await recordFacts(sql, sourceTable, row, playerRow.raw_row, archiveChecksum, latestHistory)
      const outcome =
        sourceTable === 'rating_history'
          ? await importHistory(sql, row, archiveChecksum)
          : sourceTable === 'player_alias'
            ? await importAlias(sql, row, archiveChecksum)
            : 'transformed'
      await finishLedger(sql, sourceTable, row.source_key, archiveChecksum, outcome)
    }
  }
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

function validateOptions(options: LegacyPlayerImportOptions): { batchSize: number; maxBatches: number } {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Player import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Player import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches }
}

export async function importLegacyPlayers(
  connectionString: string,
  options: LegacyPlayerImportOptions = {},
): Promise<LegacyPlayerImportResult> {
  const { batchSize, maxBatches } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client.unsafe('SET statement_timeout = 30000')
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    await client.unsafe('SET statement_timeout = 0')

    const manifest = await computeSourceManifest(client)
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
      await reject(
        client,
        'manifest',
        manifest.sourceChecksum,
        'source-manifest-changed',
        { frozen: progress.source_manifest, current: manifest },
        manifest.sourceChecksum,
      )
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
      const playerRows = await client.unsafe<SourceDatabaseRow[]>(
        `${sourceRowsSql(
          playerSource,
          'WHERE ($1::integer IS NULL OR brawlhalla_id > $1::integer)',
          'brawlhalla_id',
        )} LIMIT $2`,
        [cursor, batchSize],
      )
      const players = playerRows.map(normalizeSourceRow)
      if (players.length === 0) {
        await client`
          UPDATE players.legacy_import_progress
          SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE singleton
        `
        completed = true
        break
      }
      await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
        for (const player of players) await importPlayer(sql, player)
        await enqueueDiscoveryBatch(sql, players.map((player) => player.brawlhalla_id).filter(positiveInteger))
        cursor = players.at(-1)?.brawlhalla_id ?? null
        await sql`
          UPDATE players.legacy_import_progress
          SET status = 'in-progress', last_player_id = ${cursor}, updated_at = clock_timestamp()
          WHERE singleton
        `
      })
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
