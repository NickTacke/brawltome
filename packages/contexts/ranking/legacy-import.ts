import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { PublishedLeaderboardIdentity, PublishedLeaderboardRow } from './leaderboard'
import {
  type LeaderboardMode,
  type RegionalLeaderboardScope,
  leaderboardModes,
  regionalLeaderboardScopes,
} from './v1-leaderboard-source'

const IMPORT_LOCK_KEY = 223_202_001
const DEFAULT_BATCH_SIZE = 10_000
const MANIFEST_VERSION = 1
const SET_MAXIMUM_SPAN_MS = 15 * 60 * 1_000
const MAX_ARCHIVE_ROWS_IN_MEMORY = 250_000
const EMPTY_CHECKSUM = createHash('sha256').update('').digest('hex')

type Sql = ReturnType<typeof postgres>
type RawRow = Record<string, unknown>
type SourceDatabaseRow = RawRow & { source_key: string; raw_json: string }
type SourceRow = { source_key: string; raw_json: string; raw_row: RawRow }
type SourceDefinition = {
  table: 'player' | 'player_ranked_team'
  keyExpression: string
}
type LoadedArchive = {
  players: SourceRow[]
  playerById: Map<number, SourceRow>
  teams: SourceRow[]
}
type SourceManifest = {
  version: typeof MANIFEST_VERSION
  rowCounts: Record<string, number>
  sourceRows: number
  sourceChecksum: string
}
type ProgressRow = {
  status: LegacyRankingImportResult['status']
  stage: 'archive-player' | 'archive-team' | 'sets'
  last_source_key: string | null
  last_mode: LeaderboardMode | null
  source_manifest: SourceManifest
  source_checksum: string
  block_reason: Record<string, unknown> | null
}
type RankingGates = {
  completeness: boolean
  ordering: boolean
  contestantIdentity: boolean
  cardinality: boolean
  immutability: boolean
}
type EvaluatedSet = {
  mode: LeaderboardMode
  scope: RegionalLeaderboardScope
  status: 'accepted' | 'rejected'
  sourceRowCount: number
  candidateRowCount: number
  gates: RankingGates
  reasons: string[]
  sourceKeys: Array<{ table: SourceDefinition['table']; key: string }>
  rows: PublishedLeaderboardRow[]
  observedAt: Date | null
}
type Reconciliation = {
  sourceRows: number
  archivedRows: number
  acceptedSets: number
  rejectedSets: number
  publishedModes: number
  publishedSnapshots: number
  publishedRows: number
  sourceChecksum: string
  archiveChecksum: string
  semanticExact: boolean
  exact: boolean
}

export type LegacyRankingImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: { stage: ProgressRow['stage']; sourceKey: string | null } | null
  reconciliation: Reconciliation
}

export type LegacyRankingImportOptions = {
  batchSize?: number
  maxBatches?: number
}

export type LegacyRankingMigrationEntryEvidence = {
  standing: number
  sourceRank: number
  identity: PublishedLeaderboardIdentity
  region: RegionalLeaderboardScope
  rating: number
  peakRating: number | null
  wins: number
  losses: number
  games: number
  tier: string | null
}

export type LegacyRankingMigrationSetEvidence = {
  mode: LeaderboardMode
  scope: RegionalLeaderboardScope
  status: 'accepted' | 'rejected'
  reasons: string[]
  snapshotId: string | null
  rowCount: number
  sourceChecksum: string
  entries: LegacyRankingMigrationEntryEvidence[]
}

export type LegacyRankingMigrationEvidence = {
  status: 'not-started' | 'in-progress' | 'complete' | 'blocked'
  sourceChecksum: string | null
  sets: LegacyRankingMigrationSetEvidence[]
}

const SOURCES: readonly SourceDefinition[] = [
  { table: 'player', keyExpression: 'brawlhalla_id::text' },
  {
    table: 'player_ranked_team',
    keyExpression: 'jsonb_build_array(brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, region)::text',
  },
]

function sourceRowsSql(source: SourceDefinition, predicate = '', order = 'source_key'): string {
  return `SELECT source.*, ${source.keyExpression} AS source_key, to_jsonb(source)::text AS raw_json
          FROM public.${source.table} source ${predicate} ORDER BY ${order}`
}

function parseRawJson(rawJson: string): RawRow {
  try {
    const value: unknown = JSON.parse(rawJson)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('row is not an object')
    return value as RawRow
  } catch (error) {
    throw new Error('Legacy Ranking source row is not valid JSON', {
      cause: error,
    })
  }
}

function normalizeSourceRow(row: SourceDatabaseRow): SourceRow {
  const { source_key: sourceKey, raw_json: rawJson, ...rawRow } = row
  const parsedRaw = parseRawJson(rawJson)
  for (const [key, value] of Object.entries(rawRow)) {
    if (value instanceof Date && typeof parsedRaw[key] === 'string') rawRow[key] = parsedRaw[key]
  }
  return { source_key: String(sourceKey), raw_json: rawJson, raw_row: rawRow }
}

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

function jsonValue(value: unknown): Parameters<Sql['json']>[0] {
  return parseRawJson(JSON.stringify({ value }, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
    .value as Parameters<Sql['json']>[0]
}

function checksum(rawJson: string): string {
  return createHash('sha256').update(rawJson, 'utf8').digest('hex')
}

function addChecksumFrame(hash: ReturnType<typeof createHash>, table: string, key: string, rowChecksum: string): void {
  hash.update(`${table.length}:${table}${key.length}:${key}${rowChecksum}`)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647
}

function visibleText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    [...value].length <= maximum &&
    /[^\p{Separator}]/u.test(value) &&
    !/[\p{Control}\p{Format}]/u.test(value)
  )
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const text = value instanceof Date ? value.toISOString() : value
  const explicit = /(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const parsed = new Date(explicit)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function validateOptions(options: LegacyRankingImportOptions): {
  batchSize: number
  maxBatches: number
} {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Ranking import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Ranking import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches }
}

async function computeSourceManifest(client: Sql): Promise<SourceManifest> {
  const hash = createHash('sha256')
  const rowCounts: Record<string, number> = {}
  let sourceRows = 0
  for (const source of SOURCES) {
    let count = 0
    for await (const rows of client.unsafe<SourceDatabaseRow[]>(sourceRowsSql(source)).cursor(1_000)) {
      for (const databaseRow of rows) {
        const row = normalizeSourceRow(databaseRow)
        addChecksumFrame(hash, source.table, row.source_key, checksum(row.raw_json))
        count += 1
        sourceRows += 1
      }
    }
    rowCounts[source.table] = count
  }
  return {
    version: MANIFEST_VERSION,
    rowCounts,
    sourceRows,
    sourceChecksum: sourceRows === 0 ? EMPTY_CHECKSUM : hash.digest('hex'),
  }
}

async function archiveRow(sql: Sql, sourceTable: SourceDefinition['table'], row: SourceRow): Promise<void> {
  const rowChecksum = checksum(row.raw_json)
  const inserted = await sql<{ row_checksum: string }[]>`
    INSERT INTO rankings.legacy_archive
      (source_table, source_key, raw_row, row_checksum, content_checksum)
    VALUES (${sourceTable}, ${row.source_key}, ${row.raw_json}::text::jsonb, ${rowChecksum},
            encode(sha256(convert_to((${row.raw_json}::text::jsonb)::text, 'UTF8')), 'hex'))
    ON CONFLICT DO NOTHING
    RETURNING row_checksum
  `
  if (inserted.length === 1) return
  const [existing] = await sql<{ row_checksum: string; raw_matches: boolean }[]>`
    SELECT row_checksum, raw_row = ${row.raw_json}::text::jsonb AS raw_matches
    FROM rankings.legacy_archive
    WHERE source_table = ${sourceTable} AND source_key = ${row.source_key}
  `
  if (existing?.row_checksum.trim() !== rowChecksum || !existing.raw_matches) {
    throw new Error(`Ranking archive conflict for ${sourceTable}/${row.source_key}`)
  }
}

async function lockRankingSourcesAndReadManifest(sql: Sql): Promise<SourceManifest> {
  await sql.unsafe('LOCK TABLE public.player, public.player_ranked_team IN SHARE MODE')
  return computeSourceManifest(sql)
}

async function archiveBatch(
  client: Sql,
  source: SourceDefinition,
  cursor: string | null,
  batchSize: number,
  frozenManifest: SourceManifest,
): Promise<
  | { outcome: 'source-changed'; currentManifest: SourceManifest }
  | { outcome: 'exhausted' }
  | { outcome: 'archived'; cursor: string }
> {
  return client.begin(async (transaction) => {
    const sql = transaction as unknown as Sql
    const currentManifest = await lockRankingSourcesAndReadManifest(sql)
    if (stableJson(currentManifest) !== stableJson(frozenManifest)) {
      return { outcome: 'source-changed' as const, currentManifest }
    }
    const rows = await sql.unsafe<SourceDatabaseRow[]>(
      `${sourceRowsSql(source, `WHERE ($1::text IS NULL OR ${source.keyExpression} > $1::text)`)} LIMIT $2`,
      [cursor, batchSize],
    )
    if (rows.length === 0) return { outcome: 'exhausted' as const }
    for (const databaseRow of rows) await archiveRow(sql, source.table, normalizeSourceRow(databaseRow))
    return {
      outcome: 'archived' as const,
      cursor: String(rows.at(-1)?.source_key),
    }
  })
}

async function loadArchive(client: Sql): Promise<LoadedArchive> {
  const players: SourceRow[] = []
  const playerById = new Map<number, SourceRow>()
  const teams: SourceRow[] = []
  let loadedRows = 0
  for (const source of SOURCES) {
    for await (const rows of client<Array<{ source_key: string; raw_row: RawRow }>>`
      SELECT source_key, raw_row FROM rankings.legacy_archive
      WHERE source_table = ${source.table} ORDER BY source_key
    `.cursor(1_000)) {
      for (const row of rows) {
        loadedRows += 1
        if (loadedRows > MAX_ARCHIVE_ROWS_IN_MEMORY) {
          throw new Error(`Ranking legacy archive exceeds the ${MAX_ARCHIVE_ROWS_IN_MEMORY}-row memory safety bound`)
        }
        const sourceRow = {
          source_key: row.source_key,
          raw_json: stableJson(row.raw_row),
          raw_row: row.raw_row,
        }
        if (source.table === 'player') {
          players.push(sourceRow)
          const id = row.raw_row.brawlhalla_id
          if (positiveInteger(id)) playerById.set(id, sourceRow)
        } else {
          teams.push(sourceRow)
        }
      }
    }
  }
  return { players, playerById, teams }
}

function identityKey(identity: PublishedLeaderboardIdentity): string {
  return identity.type === 'fixed-two-vs-two-team'
    ? `${identity.players[0].brawlhallaId}:${identity.players[1].brawlhallaId}`
    : String(identity.player.brawlhallaId)
}

function candidateSort(left: PublishedLeaderboardRow, right: PublishedLeaderboardRow): number {
  return (
    right.rating - left.rating ||
    right.wins - left.wins ||
    identityKey(left.identity).localeCompare(identityKey(right.identity), 'en', { numeric: true })
  )
}

function dateRange(values: readonly Date[]): { minimum: number; maximum: number } | null {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const value of values) {
    const timestamp = value.getTime()
    if (timestamp < minimum) minimum = timestamp
    if (timestamp > maximum) maximum = timestamp
  }
  return values.length === 0 ? null : { minimum, maximum }
}

function emptyGates(): RankingGates {
  return {
    completeness: true,
    ordering: true,
    contestantIdentity: true,
    cardinality: true,
    immutability: true,
  }
}

function addReason(reasons: Set<string>, gates: RankingGates, gate: keyof RankingGates, reason: string): void {
  gates[gate] = false
  reasons.add(reason)
}

function sourceStats(raw: RawRow): {
  rating: number
  peakRating: number
  wins: number
  losses: number
  tier: string | null
} | null {
  if (
    !nonNegativeInteger(raw.rating) ||
    !nonNegativeInteger(raw.peak_rating) ||
    !nonNegativeInteger(raw.wins) ||
    !nonNegativeInteger(raw.games) ||
    raw.wins > raw.games ||
    raw.peak_rating < raw.rating ||
    (raw.tier !== null && !visibleText(raw.tier, 100))
  ) {
    return null
  }
  return {
    rating: raw.rating,
    peakRating: raw.peak_rating,
    wins: raw.wins,
    losses: raw.games - raw.wins,
    tier: raw.tier as string | null,
  }
}

function evaluatePlayerSet(
  mode: '1v1' | '3v3',
  scope: RegionalLeaderboardScope,
  players: readonly SourceRow[],
  immutable: boolean,
): EvaluatedSet {
  const gates = emptyGates()
  gates.immutability = immutable
  const reasons = new Set<string>()
  if (!immutable) reasons.add('destination-immutability-unavailable')
  const syncField = mode === '1v1' ? 'synced_at_1v1' : 'synced_at_3v3'
  const sourceRows = players.filter(({ raw_row }) => raw_row.region === scope && raw_row[syncField] !== null)
  const rows: PublishedLeaderboardRow[] = []
  const observed: Date[] = []
  const orderingKeys = new Set<string>()
  for (const source of sourceRows) {
    const raw = source.raw_row
    const id = raw.brawlhalla_id
    const name = raw.name
    const observedAt = timestamp(raw[syncField])
    if (!positiveInteger(id) || !visibleText(name, 256)) {
      addReason(reasons, gates, 'contestantIdentity', 'contestant-identity-invalid')
      continue
    }
    if (!observedAt) {
      addReason(reasons, gates, 'completeness', 'observation-timestamp-invalid')
      continue
    }
    const rating = mode === '1v1' ? raw.rating : raw.rating_3v3
    const peakRating = mode === '1v1' ? raw.peak_rating : raw.peak_rating_3v3
    const wins = mode === '1v1' ? raw.ranked_wins : raw.wins_3v3
    const losses =
      mode === '1v1'
        ? nonNegativeInteger(raw.ranked_games) && nonNegativeInteger(wins) && wins <= raw.ranked_games
          ? raw.ranked_games - wins
          : null
        : raw.losses_3v3
    const tier = mode === '1v1' ? raw.tier : raw.tier_3v3
    if (!nonNegativeInteger(rating) || !nonNegativeInteger(peakRating)) {
      addReason(reasons, gates, 'completeness', 'ranking-fields-invalid')
      continue
    }
    if (peakRating < rating) {
      addReason(reasons, gates, 'completeness', 'peak-rating-below-rating')
      continue
    }
    if (!nonNegativeInteger(wins) || !nonNegativeInteger(losses) || wins + losses > 2_147_483_647) {
      addReason(reasons, gates, 'completeness', 'games-cardinality-invalid')
      continue
    }
    if (tier !== null && !visibleText(tier, 100)) {
      addReason(reasons, gates, 'completeness', 'tier-invalid')
      continue
    }
    const orderingKey = `${rating}:${wins}`
    if (orderingKeys.has(orderingKey)) addReason(reasons, gates, 'ordering', 'ordering-ambiguous-tie')
    orderingKeys.add(orderingKey)
    observed.push(observedAt)
    rows.push({
      standing: 0,
      sourceRank: 0,
      identity:
        mode === '1v1'
          ? { type: 'one-vs-one-player', player: { brawlhallaId: id, name } }
          : {
              type: 'three-vs-three-player',
              player: { brawlhallaId: id, name },
            },
      region: scope,
      rating,
      peakRating,
      wins,
      losses,
      tier: tier as string | null,
    })
  }
  if (sourceRows.length === 0) addReason(reasons, gates, 'completeness', 'set-empty')
  if (rows.length !== sourceRows.length) gates.cardinality = false
  const observedRange = dateRange(observed)
  if (observedRange && observedRange.maximum - observedRange.minimum > SET_MAXIMUM_SPAN_MS) {
    addReason(reasons, gates, 'completeness', 'set-observation-span-exceeded')
  }
  rows.sort(candidateSort)
  rows.forEach((row, index) => {
    row.standing = index + 1
    row.sourceRank = index + 1
  })
  return {
    mode,
    scope,
    status: reasons.size === 0 && Object.values(gates).every(Boolean) ? 'accepted' : 'rejected',
    sourceRowCount: sourceRows.length,
    candidateRowCount: rows.length,
    gates,
    reasons: [...reasons].sort(),
    sourceKeys: sourceRows.map(({ source_key }) => ({
      table: 'player',
      key: source_key,
    })),
    rows,
    observedAt: observedRange ? new Date(observedRange.maximum) : null,
  }
}

function evaluateTeamSet(
  mode: '2v2' | 'solo2v2',
  scope: RegionalLeaderboardScope,
  players: Map<number, SourceRow>,
  teams: SourceRow[],
  immutable: boolean,
): EvaluatedSet {
  const gates = emptyGates()
  gates.immutability = immutable
  const reasons = new Set<string>()
  if (!immutable) reasons.add('destination-immutability-unavailable')
  const sourceRows = teams.filter(({ raw_row }) => {
    if (raw_row.region !== scope) return false
    return mode === '2v2' ? raw_row.brawlhalla_id_two !== 0 : raw_row.brawlhalla_id_two === 0
  })
  const groups = new Map<string, SourceRow[]>()
  for (const row of sourceRows) {
    const raw = row.raw_row
    const first = raw.brawlhalla_id_one
    const second = raw.brawlhalla_id_two
    const key =
      mode === '2v2' && positiveInteger(first) && positiveInteger(second)
        ? `${Math.min(first, second)}:${Math.max(first, second)}`
        : String(first)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const rows: PublishedLeaderboardRow[] = []
  const observed: Date[] = []
  const orderingKeys = new Set<string>()
  const sourceKeys: EvaluatedSet['sourceKeys'] = sourceRows.map(({ source_key }) => ({
    table: 'player_ranked_team',
    key: source_key,
  }))
  for (const group of groups.values()) {
    const raw = group[0]?.raw_row
    if (!raw) continue
    const firstId = raw.brawlhalla_id_one
    const secondId = raw.brawlhalla_id_two
    if (mode === '2v2') {
      const ownerIds = new Set(group.map(({ raw_row }) => raw_row.brawlhalla_id))
      if (
        !positiveInteger(firstId) ||
        !positiveInteger(secondId) ||
        firstId === secondId ||
        group.length !== 2 ||
        ownerIds.size !== 2 ||
        !ownerIds.has(firstId) ||
        !ownerIds.has(secondId)
      ) {
        addReason(reasons, gates, 'cardinality', 'fixed-team-owner-cardinality')
        continue
      }
    } else if (!positiveInteger(firstId) || secondId !== 0 || group.length !== 1 || raw.brawlhalla_id !== firstId) {
      addReason(reasons, gates, 'cardinality', 'solo-player-cardinality')
      continue
    }

    const stats = sourceStats(raw)
    if (!stats) {
      const reason =
        nonNegativeInteger(raw.rating) && nonNegativeInteger(raw.peak_rating) && raw.peak_rating < raw.rating
          ? 'peak-rating-below-rating'
          : 'ranking-fields-invalid'
      addReason(reasons, gates, 'completeness', reason)
      continue
    }
    const { synced_at: _baselineSyncedAt, brawlhalla_id: _baselineOwner, ...baseline } = raw
    if (
      group.some(({ raw_row }) => {
        const { synced_at: _syncedAt, brawlhalla_id: _owner, ...candidate } = raw_row
        return stableJson(baseline) !== stableJson(candidate)
      })
    ) {
      addReason(reasons, gates, 'cardinality', 'fixed-team-row-disagreement')
      continue
    }
    const observedRows = group.map(({ raw_row }) => timestamp(raw_row.synced_at))
    if (observedRows.some((value) => value === null)) {
      addReason(reasons, gates, 'completeness', 'observation-timestamp-invalid')
      continue
    }
    const first = players.get(firstId as number)
    const second = mode === '2v2' ? players.get(secondId as number) : null
    if (
      !first ||
      !visibleText(first.raw_row.name, 256) ||
      (mode === '2v2' && (!second || !visibleText(second.raw_row.name, 256)))
    ) {
      addReason(reasons, gates, 'contestantIdentity', 'contestant-identity-unresolved')
      continue
    }
    sourceKeys.push({ table: 'player', key: first.source_key })
    if (second) sourceKeys.push({ table: 'player', key: second.source_key })
    observed.push(...(observedRows as Date[]))
    const identity: PublishedLeaderboardIdentity =
      mode === '2v2'
        ? {
            type: 'fixed-two-vs-two-team',
            players: [
              {
                brawlhallaId: Math.min(firstId as number, secondId as number),
                name: String((firstId as number) < (secondId as number) ? first.raw_row.name : second?.raw_row.name),
              },
              {
                brawlhallaId: Math.max(firstId as number, secondId as number),
                name: String((firstId as number) < (secondId as number) ? second?.raw_row.name : first.raw_row.name),
              },
            ],
          }
        : {
            type: 'solo-two-vs-two-player',
            player: {
              brawlhallaId: firstId as number,
              name: String(first.raw_row.name),
            },
          }
    const orderingKey = `${stats.rating}:${stats.wins}`
    if (orderingKeys.has(orderingKey)) addReason(reasons, gates, 'ordering', 'ordering-ambiguous-tie')
    orderingKeys.add(orderingKey)
    rows.push({
      standing: 0,
      sourceRank: 0,
      identity,
      region: scope,
      ...stats,
    })
  }
  if (sourceRows.length === 0) addReason(reasons, gates, 'completeness', 'set-empty')
  if (mode === '2v2' && sourceRows.length !== rows.length * 2) gates.cardinality = false
  if (mode === 'solo2v2' && sourceRows.length !== rows.length) gates.cardinality = false
  const observedRange = dateRange(observed)
  if (observedRange && observedRange.maximum - observedRange.minimum > SET_MAXIMUM_SPAN_MS) {
    addReason(reasons, gates, 'completeness', 'set-observation-span-exceeded')
  }
  rows.sort(candidateSort)
  rows.forEach((row, index) => {
    row.standing = index + 1
    row.sourceRank = index + 1
  })
  return {
    mode,
    scope,
    status: reasons.size === 0 && Object.values(gates).every(Boolean) ? 'accepted' : 'rejected',
    sourceRowCount: sourceRows.length,
    candidateRowCount: rows.length,
    gates,
    reasons: [...reasons].sort(),
    sourceKeys: [...new Map(sourceKeys.map((item) => [`${item.table}/${item.key}`, item])).values()],
    rows,
    observedAt: observedRange ? new Date(observedRange.maximum) : null,
  }
}

async function destinationIsImmutable(client: Sql): Promise<boolean> {
  const required = new Map([
    ['generations:generations_are_immutable', 'reject_generation_change'],
    ['generations:rankings_generations_prevent_truncate', 'reject_immutable_change'],
    ['snapshots:snapshots_are_immutable', 'reject_immutable_change'],
    ['snapshots:rankings_snapshots_prevent_truncate', 'reject_immutable_change'],
    ['snapshots:snapshots_require_unfinalized_generation', 'require_unfinalized_generation'],
    ['snapshot_rows:snapshot_rows_are_immutable', 'reject_immutable_change'],
    ['snapshot_rows:rankings_snapshot_rows_prevent_truncate', 'reject_immutable_change'],
    ['snapshot_rows:snapshot_rows_require_unfinalized_generation', 'require_unfinalized_snapshot_generation'],
    ['legacy_archive:rankings_legacy_archive_immutable', 'reject_legacy_migration_evidence_change'],
    ['legacy_archive:rankings_legacy_archive_prevent_truncate', 'reject_legacy_migration_evidence_change'],
    ['legacy_import_sets:rankings_legacy_import_sets_immutable', 'reject_legacy_migration_evidence_change'],
    ['legacy_import_sets:rankings_legacy_import_sets_prevent_truncate', 'reject_legacy_migration_evidence_change'],
    ['legacy_set_sources:rankings_legacy_set_sources_immutable', 'reject_legacy_migration_evidence_change'],
    ['legacy_set_sources:rankings_legacy_set_sources_prevent_truncate', 'reject_legacy_migration_evidence_change'],
  ])
  const triggerNames = [...required.keys()].map((key) => key.slice(key.indexOf(':') + 1))
  const rows = await client<Array<{ relation: string; trigger: string; function_name: string }>>`
    SELECT relation.relname AS relation, trigger.tgname AS trigger, function.proname AS function_name
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
    JOIN pg_proc function ON function.oid = trigger.tgfoid
    JOIN pg_namespace function_schema ON function_schema.oid = function.pronamespace
    WHERE relation_schema.nspname = 'rankings'
      AND function_schema.nspname = 'rankings'
      AND trigger.tgname IN ${client(triggerNames)}
      AND trigger.tgenabled IN ('O', 'A')
      AND NOT trigger.tgisinternal
  `
  const actual = new Map(rows.map((row) => [`${row.relation}:${row.trigger}`, row.function_name]))
  return required.size === actual.size && [...required].every(([key, functionName]) => actual.get(key) === functionName)
}

function evaluateMode(mode: LeaderboardMode, archive: LoadedArchive, immutable: boolean): EvaluatedSet[] {
  return regionalLeaderboardScopes.map((scope) =>
    mode === '1v1' || mode === '3v3'
      ? evaluatePlayerSet(mode, scope, archive.players, immutable)
      : evaluateTeamSet(mode, scope, archive.playerById, archive.teams, immutable),
  )
}

function storedIdentity(identity: PublishedLeaderboardIdentity) {
  if (identity.type === 'fixed-two-vs-two-team') {
    return {
      identity_kind: identity.type,
      player_one_id: identity.players[0].brawlhallaId,
      player_one_name: identity.players[0].name,
      player_two_id: identity.players[1].brawlhallaId,
      player_two_name: identity.players[1].name,
    }
  }
  return {
    identity_kind: identity.type,
    player_one_id: identity.player.brawlhallaId,
    player_one_name: identity.player.name,
    player_two_id: null,
    player_two_name: null,
  }
}

async function persistSetSources(sql: Sql, set: EvaluatedSet): Promise<void> {
  for (const source of set.sourceKeys) {
    await sql`
      INSERT INTO rankings.legacy_set_sources (mode, scope, source_table, source_key)
      VALUES (${set.mode}, ${set.scope}, ${source.table}, ${source.key})
    `
  }
}

async function publishMode(
  client: Sql,
  mode: LeaderboardMode,
  sourceManifest: SourceManifest,
  archive: LoadedArchive,
): Promise<{ outcome: 'published' } | { outcome: 'source-changed'; currentManifest: SourceManifest }> {
  return client.begin(async (transaction) => {
    const sql = transaction as unknown as Sql
    const currentManifest = await lockRankingSourcesAndReadManifest(sql)
    if (stableJson(currentManifest) !== stableJson(sourceManifest)) {
      return { outcome: 'source-changed' as const, currentManifest }
    }
    const sourceChecksum = sourceManifest.sourceChecksum
    const evaluated = evaluateMode(mode, archive, await destinationIsImmutable(sql))
    const accepted = evaluated.filter((set) => set.status === 'accepted')
    let generationId: string | null = null
    if (accepted.length > 0) {
      generationId = randomUUID()
      const acceptedRange = dateRange(
        accepted.map(({ observedAt }) => {
          if (!observedAt) throw new Error(`Accepted ${mode} set has no observation timestamp`)
          return observedAt
        }),
      )
      if (!acceptedRange) throw new Error(`Accepted ${mode} generation has no observation timestamp`)
      const observedAt = new Date(acceptedRange.maximum)
      const importedAt = new Date()
      const provenance = {
        source: 'v2-legacy',
        contractVersion: 1,
        sourceChecksum,
        importedAt: importedAt.toISOString(),
        completeness: 'frozen-repository-rows',
      }
      await sql`
        INSERT INTO rankings.generations
          (id, operation_id, operation_key, mode, observed_at, schedule_window_at, published_at,
           expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
        VALUES
          (${generationId}, ${randomUUID()}, ${`legacy-import:${mode}:${sourceChecksum}`}, ${mode}, ${observedAt},
           ${observedAt}, ${importedAt}, ${new Date(observedAt.getTime() + 1)}, NULL, 'v2-legacy', 1, false,
           ${sql.json(jsonValue(provenance))})
      `
    }

    for (const set of evaluated) {
      let snapshotId: string | null = null
      if (set.status === 'accepted') {
        if (!generationId) throw new Error(`Accepted ${mode} set has no generation`)
        snapshotId = randomUUID()
        await sql`
          INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
          VALUES (${snapshotId}, ${generationId}, ${mode}, ${set.scope}, ${set.rows.length})
        `
        const storedRows = set.rows.map((row, index) => ({
          snapshot_id: snapshotId,
          mode,
          ordinal: index + 1,
          standing: row.standing,
          source_rank: row.sourceRank,
          ...storedIdentity(row.identity),
          region: row.region,
          rating: row.rating,
          peak_rating: row.peakRating,
          wins: row.wins,
          losses: row.losses,
          tier: row.tier,
        }))
        for (let offset = 0; offset < storedRows.length; offset += 500) {
          await sql`
            INSERT INTO rankings.snapshot_rows ${sql(
              storedRows.slice(offset, offset + 500),
              'snapshot_id',
              'mode',
              'ordinal',
              'standing',
              'source_rank',
              'identity_kind',
              'player_one_id',
              'player_one_name',
              'player_two_id',
              'player_two_name',
              'region',
              'rating',
              'peak_rating',
              'wins',
              'losses',
              'tier',
            )}
          `
        }
      }
      await sql`
        INSERT INTO rankings.legacy_import_sets
          (mode, scope, status, source_row_count, candidate_row_count, gates, reasons,
           source_checksum, generation_id, snapshot_id)
        VALUES
          (${mode}, ${set.scope}, ${set.status}, ${set.sourceRowCount}, ${set.candidateRowCount},
           ${sql.json(jsonValue(set.gates))}, ${set.reasons}, ${sourceChecksum},
           ${set.status === 'accepted' ? generationId : null}, ${snapshotId})
      `
      await persistSetSources(sql, set)
    }
    if (generationId) await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
    await sql`
      UPDATE rankings.legacy_import_progress
      SET stage = 'sets', last_mode = ${mode}, last_source_key = NULL, updated_at = clock_timestamp()
      WHERE singleton
    `
    return { outcome: 'published' as const }
  })
}

async function sourceArchiveExact(client: Sql): Promise<boolean> {
  for (const source of SOURCES) {
    const [result] = await client.unsafe<{ exact: boolean }[]>(
      `WITH current_source AS (${sourceRowsSql(source)})
       SELECT NOT EXISTS (
         SELECT 1 FROM current_source source
         FULL JOIN (
           SELECT * FROM rankings.legacy_archive WHERE source_table = $1
         ) archive ON archive.source_key = source.source_key
         WHERE source.source_key IS NULL OR archive.source_key IS NULL
            OR archive.row_checksum <> encode(sha256(convert_to(source.raw_json, 'UTF8')), 'hex')
            OR archive.raw_row IS DISTINCT FROM source.raw_json::jsonb
       ) AS exact`,
      [source.table],
    )
    if (!result?.exact) return false
  }
  return true
}

async function reconcile(client: Sql, manifest: SourceManifest): Promise<Reconciliation> {
  const archiveHash = createHash('sha256')
  let archivedRows = 0
  for (const source of SOURCES) {
    for await (const rows of client<Array<{ source_key: string; row_checksum: string }>>`
      SELECT source_key, row_checksum FROM rankings.legacy_archive
      WHERE source_table = ${source.table} ORDER BY source_key
    `.cursor(1_000)) {
      for (const row of rows) {
        addChecksumFrame(archiveHash, source.table, row.source_key, row.row_checksum.trim())
        archivedRows += 1
      }
    }
  }
  const archiveChecksum = archivedRows === 0 ? EMPTY_CHECKSUM : archiveHash.digest('hex')
  const [counts] = await client<
    Array<{
      accepted: number
      rejected: number
      modes: number
      snapshots: number
      rows: number
      semantic_exact: boolean
    }>
  >`
    SELECT
      (SELECT count(*)::integer FROM rankings.legacy_import_sets WHERE status = 'accepted') AS accepted,
      (SELECT count(*)::integer FROM rankings.legacy_import_sets WHERE status = 'rejected') AS rejected,
      (SELECT count(DISTINCT mode)::integer FROM rankings.generations
       WHERE source = 'v2-legacy' AND finalized) AS modes,
      (SELECT count(*)::integer FROM rankings.snapshots snapshot
       JOIN rankings.generations generation ON generation.id = snapshot.generation_id
       WHERE generation.source = 'v2-legacy' AND generation.finalized) AS snapshots,
      (SELECT count(*)::integer FROM rankings.snapshot_rows row
       JOIN rankings.snapshots snapshot ON snapshot.id = row.snapshot_id
       JOIN rankings.generations generation ON generation.id = snapshot.generation_id
       WHERE generation.source = 'v2-legacy' AND generation.finalized) AS rows,
      NOT EXISTS (
        SELECT 1 FROM rankings.legacy_archive archive
        WHERE archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
      )
      AND NOT EXISTS (
        SELECT 1 FROM rankings.legacy_import_sets imported
        LEFT JOIN rankings.generations generation ON generation.id = imported.generation_id
        LEFT JOIN rankings.snapshots snapshot ON snapshot.id = imported.snapshot_id
        WHERE imported.source_checksum <> ${manifest.sourceChecksum}
           OR (imported.status = 'accepted' AND (
             imported.reasons <> '{}'::text[]
             OR imported.gates <> '{"completeness":true,"ordering":true,"contestantIdentity":true,"cardinality":true,"immutability":true}'::jsonb
             OR NOT generation.finalized
             OR generation.source <> 'v2-legacy'
             OR snapshot.row_count <> imported.candidate_row_count
             OR snapshot.row_count <> (SELECT count(*) FROM rankings.snapshot_rows row WHERE row.snapshot_id = snapshot.id)
           ))
           OR (imported.status = 'rejected' AND (
             cardinality(imported.reasons) = 0
             OR NOT EXISTS (SELECT 1 FROM jsonb_each_text(imported.gates) gate WHERE gate.value = 'false')
           ))
      ) AS semantic_exact
  `
  const semanticExact = (await sourceArchiveExact(client)) && counts.semantic_exact
  const expectedSets = leaderboardModes.length * regionalLeaderboardScopes.length
  const exact =
    manifest.sourceRows === archivedRows &&
    manifest.sourceChecksum === archiveChecksum &&
    counts.accepted + counts.rejected === expectedSets &&
    counts.accepted === counts.snapshots &&
    semanticExact
  return {
    sourceRows: manifest.sourceRows,
    archivedRows,
    acceptedSets: counts.accepted,
    rejectedSets: counts.rejected,
    publishedModes: counts.modes,
    publishedSnapshots: counts.snapshots,
    publishedRows: counts.rows,
    sourceChecksum: manifest.sourceChecksum,
    archiveChecksum,
    semanticExact,
    exact,
  }
}

async function blockForSourceChange(client: Sql, progress: ProgressRow): Promise<SourceManifest> {
  const current = await client.begin(async (transaction) => {
    const sql = transaction as unknown as Sql
    const lockedManifest = await lockRankingSourcesAndReadManifest(sql)
    await sql`
      UPDATE rankings.legacy_import_progress
      SET status = 'blocked', completed_at = NULL,
          block_reason = ${sql.json(
            jsonValue({
              code: 'source-manifest-changed',
              frozen: progress.source_manifest,
              current: lockedManifest,
            }),
          )},
          updated_at = clock_timestamp()
      WHERE singleton
    `
    return lockedManifest
  })
  progress.status = 'blocked'
  return current
}

function checkpoint(progress: ProgressRow): LegacyRankingImportResult['checkpoint'] {
  if (progress.status === 'complete') return null
  return {
    stage: progress.stage,
    sourceKey: progress.stage === 'sets' ? progress.last_mode : progress.last_source_key,
  }
}

export async function readLegacyRankingMigrationEvidence(
  connectionString: string,
): Promise<LegacyRankingMigrationEvidence> {
  const client = postgres(connectionString, { max: 1 })
  try {
    const [progress] = await client<
      {
        status: 'in-progress' | 'complete' | 'blocked'
        source_checksum: string
      }[]
    >`SELECT status, source_checksum FROM rankings.legacy_import_progress WHERE singleton`
    const sets = await client<
      Array<{
        mode: LeaderboardMode
        scope: RegionalLeaderboardScope
        status: 'accepted' | 'rejected'
        reasons: string[]
        snapshot_id: string | null
        candidate_row_count: number
        source_checksum: string
      }>
    >`
      SELECT mode, scope, status, reasons, snapshot_id, candidate_row_count, source_checksum
      FROM rankings.legacy_import_sets
      ORDER BY mode COLLATE "C", scope COLLATE "C"
    `
    const archive = await loadArchive(client)
    const immutable = await destinationIsImmutable(client)
    const evaluatedByIdentity = new Map(
      leaderboardModes
        .flatMap((mode) => evaluateMode(mode, archive, immutable))
        .map((set) => [`${set.mode}:${set.scope}`, set] as const),
    )
    return {
      status: progress?.status ?? 'not-started',
      sourceChecksum: progress?.source_checksum.trim() ?? null,
      sets: sets.map((set) => {
        const evaluated = evaluatedByIdentity.get(`${set.mode}:${set.scope}`)
        return {
          mode: set.mode,
          scope: set.scope,
          status: set.status,
          reasons: evaluated?.reasons ?? set.reasons,
          snapshotId: set.snapshot_id,
          rowCount: evaluated?.rows.length ?? set.candidate_row_count,
          sourceChecksum: set.source_checksum.trim(),
          entries:
            evaluated?.rows.slice(0, 100).map((row) => ({
              ...row,
              games: row.wins + row.losses,
            })) ?? [],
        }
      }),
    }
  } finally {
    await client.end()
  }
}

export async function importLegacyRankings(
  connectionString: string,
  options: LegacyRankingImportOptions = {},
): Promise<LegacyRankingImportResult> {
  const { batchSize, maxBatches } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client.unsafe("SET lock_timeout = '30s'")
    await client.unsafe('SET statement_timeout = 30000')
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    await client.unsafe('SET statement_timeout = 0')

    const manifest = await client.begin(async (transaction) =>
      lockRankingSourcesAndReadManifest(transaction as unknown as Sql),
    )
    let [progress] = await client<ProgressRow[]>`
      SELECT status, stage, last_source_key, last_mode, source_manifest, source_checksum, block_reason
      FROM rankings.legacy_import_progress WHERE singleton
    `
    if (!progress) {
      ;[progress] = await client<ProgressRow[]>`
        INSERT INTO rankings.legacy_import_progress
          (status, stage, source_manifest, source_checksum)
        VALUES ('in-progress', 'archive-player', ${client.json(jsonValue(manifest))}, ${manifest.sourceChecksum})
        RETURNING status, stage, last_source_key, last_mode, source_manifest, source_checksum, block_reason
      `
    } else if (
      progress.source_checksum.trim() !== manifest.sourceChecksum ||
      stableJson(progress.source_manifest) !== stableJson(manifest)
    ) {
      const blockedManifest = await blockForSourceChange(client, progress)
      return {
        status: 'blocked',
        checkpoint: checkpoint(progress),
        reconciliation: await reconcile(client, blockedManifest),
      }
    }
    if (progress.status === 'blocked') {
      return {
        status: 'blocked',
        checkpoint: checkpoint(progress),
        reconciliation: await reconcile(client, manifest),
      }
    }

    let batches = 0
    while (progress.stage !== 'sets' && batches < maxBatches) {
      const sourceIndex = progress.stage === 'archive-player' ? 0 : 1
      const source = SOURCES[sourceIndex]
      if (!source) throw new Error(`Ranking source stage ${progress.stage} is invalid`)
      const batch = await archiveBatch(client, source, progress.last_source_key, batchSize, progress.source_manifest)
      if (batch.outcome === 'source-changed') {
        const blockedManifest = await blockForSourceChange(client, progress)
        return {
          status: 'blocked',
          checkpoint: checkpoint(progress),
          reconciliation: await reconcile(client, blockedManifest),
        }
      }
      if (batch.outcome === 'archived') {
        progress.last_source_key = batch.cursor
        await client`
          UPDATE rankings.legacy_import_progress
          SET last_source_key = ${batch.cursor}, updated_at = clock_timestamp()
          WHERE singleton
        `
        batches += 1
        continue
      }
      progress.stage = sourceIndex === 0 ? 'archive-team' : 'sets'
      progress.last_source_key = null
      await client`
        UPDATE rankings.legacy_import_progress
        SET stage = ${progress.stage}, last_source_key = NULL, updated_at = clock_timestamp()
        WHERE singleton
      `
    }

    if (progress.stage !== 'sets') {
      return {
        status: 'in-progress',
        checkpoint: checkpoint(progress),
        reconciliation: await reconcile(client, manifest),
      }
    }

    const completedModeIndex = progress.last_mode ? leaderboardModes.indexOf(progress.last_mode) : -1
    const [archiveSize] = await client<{ rows: number }[]>`
      SELECT LEAST(count(*), ${MAX_ARCHIVE_ROWS_IN_MEMORY + 1})::integer AS rows
      FROM rankings.legacy_archive
    `
    if (!archiveSize || archiveSize.rows > MAX_ARCHIVE_ROWS_IN_MEMORY) {
      await client`
        UPDATE rankings.legacy_import_progress
        SET status = 'blocked', completed_at = NULL,
            block_reason = ${client.json(
              jsonValue({
                code: 'archive-memory-safety-bound-exceeded',
                maximumRows: MAX_ARCHIVE_ROWS_IN_MEMORY,
                observedRows: archiveSize?.rows ?? null,
              }),
            )},
            updated_at = clock_timestamp()
        WHERE singleton
      `
      progress.status = 'blocked'
      return {
        status: 'blocked',
        checkpoint: checkpoint(progress),
        reconciliation: await reconcile(client, progress.source_manifest),
      }
    }
    const archive = await loadArchive(client)
    for (const mode of leaderboardModes.slice(completedModeIndex + 1)) {
      const publication = await publishMode(client, mode, progress.source_manifest, archive)
      if (publication.outcome === 'source-changed') {
        const blockedManifest = await blockForSourceChange(client, progress)
        return {
          status: 'blocked',
          checkpoint: checkpoint(progress),
          reconciliation: await reconcile(client, blockedManifest),
        }
      }
      progress.last_mode = mode
    }
    await client`
      UPDATE rankings.legacy_import_progress
      SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE singleton
    `
    progress.status = 'complete'

    const reconciliation = await reconcile(client, manifest)
    if (!reconciliation.exact) {
      await client`
        UPDATE rankings.legacy_import_progress
        SET status = 'blocked', completed_at = NULL,
            block_reason = ${client.json(jsonValue({ code: 'reconciliation-failed', reconciliation }))},
            updated_at = clock_timestamp()
        WHERE singleton
      `
      progress.status = 'blocked'
      return {
        status: 'blocked',
        checkpoint: checkpoint(progress),
        reconciliation,
      }
    }
    return { status: 'complete', checkpoint: null, reconciliation }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
