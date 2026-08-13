import { createHash } from 'node:crypto'
import postgres from 'postgres'

const IMPORT_LOCK_KEY = 223_198_001
const DEFAULT_BATCH_SIZE = 250
const MAX_RELATED_ROWS_PER_CLAN = 10_000
const MANIFEST_VERSION = 1
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
  table: 'clan' | 'clan_member' | 'player_clan'
  keyExpression: string
  identityExpression: string
}
type SourceManifest = {
  version: typeof MANIFEST_VERSION
  rowCounts: Record<string, number>
  sourceRows: number
  sourceChecksum: string
}
type ProgressRow = {
  status: LegacyClanImportResult['status']
  last_clan_id: number | null
  source_manifest: SourceManifest
  source_checksum: string
}
type Reconciliation = {
  sourceRows: number
  archivedRows: number
  transformedRows: number
  rejectedRows: number
  clanProfiles: number
  members: number
  sourceChecksum: string
  archiveChecksum: string
  semanticExact: boolean
  exact: boolean
}

export type LegacyClanImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: { stage: 'clans'; sourceKey: string } | null
  reconciliation: Reconciliation
}

export type LegacyClanImportOptions = {
  batchSize?: number
  maxBatches?: number
}

const SOURCES: readonly SourceDefinition[] = [
  {
    table: 'clan',
    keyExpression: 'clan_id::text',
    identityExpression: 'NULL::integer',
  },
  {
    table: 'clan_member',
    keyExpression: "clan_id::text || ':' || brawlhalla_id::text",
    identityExpression: 'brawlhalla_id',
  },
  {
    table: 'player_clan',
    keyExpression: 'brawlhalla_id::text',
    identityExpression: 'brawlhalla_id',
  },
]

function sourceRowsSql(source: SourceDefinition, predicate = '', order = 'source_key'): string {
  return `SELECT source.*, ${source.keyExpression} AS source_key,
                 ${source.identityExpression} AS brawlhalla_id,
                 to_jsonb(source)::text AS raw_json
          FROM public.${source.table} source ${predicate} ORDER BY ${order}`
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

function addChecksumFrame(hash: ReturnType<typeof createHash>, table: string, key: string, checksum: string): void {
  hash.update(`${table.length}:${table}${key.length}:${key}${checksum}`)
}

function parseRawJson(rawJson: string): RawRow {
  try {
    const value: unknown = JSON.parse(rawJson)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('row is not an object')
    return value as RawRow
  } catch (error) {
    throw new Error('Legacy Clan source row is not valid JSON', {
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
  return {
    source_key: String(sourceKey),
    brawlhalla_id: row.brawlhalla_id === null ? null : Number(row.brawlhalla_id),
    raw_json: rawJson,
    raw_row: rawRow,
  }
}

function jsonValue(value: unknown): Parameters<Sql['json']>[0] {
  return parseRawJson(JSON.stringify({ value }, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)))
    .value as Parameters<Sql['json']>[0]
}

function checksum(rawJson: string): string {
  return createHash('sha256').update(rawJson, 'utf8').digest('hex')
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function visibleText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    [...value].length <= maximum &&
    /[^\p{Separator}]/u.test(value) &&
    !/[\p{Control}\p{Format}]/u.test(value)
  )
}

function decimal(value: unknown): string | null {
  if ((typeof value === 'number' && Number.isSafeInteger(value)) || typeof value === 'bigint') {
    const text = String(value)
    return /^\d+$/u.test(text) ? text : null
  }
  return typeof value === 'string' && /^\d+$/u.test(value) ? value : null
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const text = value instanceof Date ? value.toISOString() : value
  const explicit = /(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const parsed = new Date(explicit)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function timestampText(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  throw new Error('Validated legacy timestamp changed type')
}

function validateOptions(options: LegacyClanImportOptions): {
  batchSize: number
  maxBatches: number
} {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Clan import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Clan import maxBatches must be a positive integer')
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
      for (const row of rows) {
        const normalized = normalizeSourceRow(row)
        addChecksumFrame(hash, source.table, normalized.source_key, checksum(normalized.raw_json))
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

async function archiveRow(sql: Sql, sourceTable: string, row: SourceRow): Promise<string> {
  const rowChecksum = checksum(row.raw_json)
  const inserted = await sql<{ row_checksum: string }[]>`
    INSERT INTO clans.legacy_archive
      (source_table, source_key, brawlhalla_id, raw_row, row_checksum, content_checksum)
    VALUES
      (${sourceTable}, ${row.source_key}, ${row.brawlhalla_id}, ${row.raw_json}::text::jsonb,
       ${rowChecksum}, encode(sha256(convert_to((${row.raw_json}::text::jsonb)::text, 'UTF8')), 'hex'))
    ON CONFLICT (source_table, source_key) DO NOTHING
    RETURNING row_checksum
  `
  if (inserted.length === 1) return rowChecksum
  const [existing] = await sql<{ row_checksum: string; raw_matches: boolean }[]>`
    SELECT row_checksum, raw_row = ${row.raw_json}::text::jsonb AS raw_matches
    FROM clans.legacy_archive
    WHERE source_table = ${sourceTable} AND source_key = ${row.source_key}
  `
  if (existing?.row_checksum.trim() !== rowChecksum || !existing.raw_matches) {
    throw new Error(`Clan archive conflict for ${sourceTable}/${row.source_key}`)
  }
  return rowChecksum
}

async function finishLedger(
  sql: Sql,
  sourceTable: string,
  sourceKey: string,
  archiveChecksum: string,
  outcome: 'transformed' | 'rejected',
): Promise<void> {
  await sql`
    INSERT INTO clans.legacy_import_ledger (source_table, source_key, archive_checksum, outcome)
    VALUES (${sourceTable}, ${sourceKey}, ${archiveChecksum}, ${outcome})
    ON CONFLICT DO NOTHING
  `
}

async function reject(sql: Sql, sourceTable: string, row: SourceRow, code: string, evidence: unknown): Promise<void> {
  const archiveChecksum = await archiveRow(sql, sourceTable, row)
  await sql`
    INSERT INTO clans.legacy_import_rejections
      (source_table, source_key, code, evidence, archive_checksum)
    VALUES (${sourceTable}, ${row.source_key}, ${code}, ${sql.json(jsonValue(evidence))}, ${archiveChecksum})
    ON CONFLICT DO NOTHING
  `
  await finishLedger(sql, sourceTable, row.source_key, archiveChecksum, 'rejected')
}

async function transform(sql: Sql, sourceTable: string, row: SourceRow): Promise<string> {
  const archiveChecksum = await archiveRow(sql, sourceTable, row)
  await finishLedger(sql, sourceTable, row.source_key, archiveChecksum, 'transformed')
  return archiveChecksum
}

async function readRows(
  sql: Sql,
  source: SourceDefinition,
  predicate: string,
  parameters: unknown[],
): Promise<SourceRow[]> {
  return (await sql.unsafe<SourceDatabaseRow[]>(sourceRowsSql(source, predicate), parameters as never[])).map(
    normalizeSourceRow,
  )
}

function clanIsValid(raw: RawRow): boolean {
  return (
    positiveInteger(raw.clan_id) &&
    visibleText(raw.clan_name, 256) &&
    timestamp(raw.clan_create_date) !== null &&
    decimal(raw.clan_xp) !== null &&
    decimal(raw.clan_lifetime_xp) !== null &&
    timestamp(raw.last_updated) !== null
  )
}

function memberIsValid(raw: RawRow): boolean {
  return (
    positiveInteger(raw.clan_id) &&
    positiveInteger(raw.brawlhalla_id) &&
    visibleText(raw.name, 256) &&
    visibleText(raw.rank, 64) &&
    timestamp(raw.join_date) !== null &&
    nonNegativeInteger(raw.xp)
  )
}

function membershipAgrees(clan: RawRow, member: RawRow, membership: RawRow): boolean {
  return (
    membership.clan_id === member.clan_id &&
    membership.clan_name === clan.clan_name &&
    decimal(membership.clan_xp) === decimal(clan.clan_xp) &&
    decimal(membership.clan_lifetime_xp) === decimal(clan.clan_lifetime_xp) &&
    membership.personal_xp === member.xp
  )
}

async function importClanProfile(input: {
  sql: Sql
  clanRow: SourceRow
  clanId: number
  observedAt: Date
  clanXp: string
  lifetimeXp: string
}): Promise<void> {
  const { sql, clanRow, clanId, observedAt, clanXp, lifetimeXp } = input
  const archiveChecksum = await archiveRow(sql, 'clan', clanRow)
  await sql`INSERT INTO clans.clans (clan_id) VALUES (${clanId}) ON CONFLICT DO NOTHING`
  const [destination] = await sql<
    Array<{
      profile_exists: boolean
      state_exists: boolean
      owner_success: boolean
      legacy_exact: boolean
    }>
  >`
    SELECT profile.clan_id IS NOT NULL AS profile_exists,
           state.clan_id IS NOT NULL AS state_exists,
           state.last_success_at IS NOT NULL
             AND state.last_success_provenance->>'source' = 'v1-guild-stats' AS owner_success,
           state.check_provenance->>'source' = 'legacy-import'
             AND state.check_provenance->>'archiveChecksum' = ${archiveChecksum}
             AND profile.clan_name = ${String(clanRow.raw_row.clan_name)}
             AND profile.clan_create_date =
               (${timestampText(clanRow.raw_row.clan_create_date)}::text::timestamp AT TIME ZONE 'UTC')
             AND profile.clan_xp = ${clanXp}
             AND profile.clan_lifetime_xp = ${lifetimeXp} AS legacy_exact
    FROM clans.clans identity
    LEFT JOIN clans.profiles profile ON profile.clan_id = identity.clan_id
    LEFT JOIN clans.profile_state state ON state.clan_id = identity.clan_id
    WHERE identity.clan_id = ${clanId}
  `
  if (destination?.legacy_exact) {
    await finishLedger(sql, 'clan', clanRow.source_key, archiveChecksum, 'transformed')
    return
  }
  if (destination?.owner_success) {
    await reject(sql, 'clan', clanRow, 'destination-owner-profile-preserved', {
      clanId,
    })
    return
  }
  if (destination?.profile_exists || destination?.state_exists) {
    await reject(sql, 'clan', clanRow, 'destination-profile-conflict', {
      clanId,
    })
    return
  }

  const profileProvenance = {
    source: 'legacy-import',
    outcome: 'legacy-unknown',
    legacyTimestamp: observedAt.toISOString(),
    sourceTable: 'clan',
    sourceKey: clanRow.source_key,
    archiveChecksum,
  }
  const insertedProfile = await sql<{ clan_id: number }[]>`
    INSERT INTO clans.profiles (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp)
    VALUES (${clanId}, ${String(clanRow.raw_row.clan_name)},
            (${timestampText(clanRow.raw_row.clan_create_date)}::text::timestamp AT TIME ZONE 'UTC'),
            ${clanXp}, ${lifetimeXp})
    ON CONFLICT DO NOTHING
    RETURNING clan_id
  `
  const insertedState = await sql<{ clan_id: number }[]>`
    INSERT INTO clans.profile_state
      (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
    VALUES (${clanId}, (${timestampText(clanRow.raw_row.last_updated)}::text::timestamp AT TIME ZONE 'UTC'),
            ${sql.json(profileProvenance)}, NULL, NULL)
    ON CONFLICT DO NOTHING
    RETURNING clan_id
  `
  if (insertedProfile.length !== 1 || insertedState.length !== 1) {
    throw new Error(`Clan profile destination changed concurrently for ${clanId}`)
  }
  await finishLedger(sql, 'clan', clanRow.source_key, archiveChecksum, 'transformed')
}

async function rejectRelatedRows(sql: Sql, source: SourceDefinition, clanId: number, code: string): Promise<void> {
  while (true) {
    const rows = await sql.unsafe<SourceDatabaseRow[]>(
      `${sourceRowsSql(
        source,
        `WHERE clan_id = $1 AND NOT EXISTS (
           SELECT 1 FROM clans.legacy_import_ledger ledger
           WHERE ledger.source_table = '${source.table}'
             AND ledger.source_key = ${source.keyExpression}
         )`,
      )} LIMIT 1000`,
      [clanId],
    )
    if (rows.length === 0) return
    for (const databaseRow of rows) {
      const row = normalizeSourceRow(databaseRow)
      await reject(sql, source.table, row, code, { clanId, row: row.raw_row })
    }
  }
}

async function processClan(sql: Sql, clanRow: SourceRow): Promise<void> {
  const clanSource = SOURCES[0]
  const memberSource = SOURCES[1]
  const membershipSource = SOURCES[2]
  if (!clanSource || !memberSource || !membershipSource) throw new Error('Clan source registry is invalid')

  const clanId = Number(clanRow.raw_row.clan_id)
  if (!clanIsValid(clanRow.raw_row)) {
    await reject(sql, clanSource.table, clanRow, 'clan-identity-invalid', { clanId })
    if (positiveInteger(clanId)) {
      await rejectRelatedRows(sql, memberSource, clanId, 'clan-parent-invalid')
      await rejectRelatedRows(sql, membershipSource, clanId, 'clan-parent-invalid')
    }
    return
  }

  const [relatedCount] = await sql<{ count: number }[]>`
    SELECT LEAST(
      (SELECT count(*) FROM public.clan_member WHERE clan_id = ${clanId}) +
      (SELECT count(*) FROM public.player_clan WHERE clan_id = ${clanId}),
      ${MAX_RELATED_ROWS_PER_CLAN + 1}
    )::integer AS count
  `
  if (!relatedCount || relatedCount.count > MAX_RELATED_ROWS_PER_CLAN) {
    await reject(sql, clanSource.table, clanRow, 'clan-related-row-safety-bound-exceeded', {
      clanId,
      maximum: MAX_RELATED_ROWS_PER_CLAN,
      count: relatedCount?.count ?? null,
    })
    await rejectRelatedRows(sql, memberSource, clanId, 'clan-related-row-safety-bound-exceeded')
    await rejectRelatedRows(sql, membershipSource, clanId, 'clan-related-row-safety-bound-exceeded')
    return
  }

  const members = await readRows(sql, memberSource, 'WHERE clan_id = $1', [clanId])
  const memberships = await readRows(sql, membershipSource, 'WHERE clan_id = $1', [clanId])
  const memberPlayerIds = members
    .map(({ raw_row }) => raw_row.brawlhalla_id)
    .filter((playerId): playerId is number => positiveInteger(playerId))
  const duplicateRows =
    memberPlayerIds.length === 0
      ? []
      : await sql<{ brawlhalla_id: number }[]>`
          SELECT brawlhalla_id FROM pg_temp.legacy_clan_duplicate_members
          WHERE brawlhalla_id IN ${sql(memberPlayerIds)}
        `
  const duplicatePlayerIds = new Set(duplicateRows.map(({ brawlhalla_id }) => brawlhalla_id))
  const membershipByPlayer = new Map(memberships.map((row) => [row.raw_row.brawlhalla_id, row]))

  const observedAt = timestamp(clanRow.raw_row.last_updated)
  const createDate = timestamp(clanRow.raw_row.clan_create_date)
  const clanXp = decimal(clanRow.raw_row.clan_xp)
  const lifetimeXp = decimal(clanRow.raw_row.clan_lifetime_xp)
  if (!observedAt || !createDate || !clanXp || !lifetimeXp) throw new Error(`Validated clan ${clanId} became invalid`)
  await importClanProfile({
    sql,
    clanRow,
    clanId,
    observedAt,
    clanXp,
    lifetimeXp,
  })

  const [existingRosterState] = await sql<{ owner_success: boolean }[]>`
    SELECT last_success_at IS NOT NULL
             AND last_success_provenance->>'source' = 'v1-guild-members' AS owner_success
    FROM clans.roster_state WHERE clan_id = ${clanId}
  `
  if (existingRosterState) {
    const reason = existingRosterState.owner_success
      ? 'destination-owner-roster-preserved'
      : 'destination-roster-state-conflict'
    for (const member of members) {
      const playerId = member.raw_row.brawlhalla_id
      const [membership] = positiveInteger(playerId)
        ? await readRows(sql, membershipSource, 'WHERE brawlhalla_id = $1', [playerId])
        : []
      await reject(sql, memberSource.table, member, reason, {
        clanId,
        member: member.raw_row,
      })
      if (membership) {
        await reject(sql, membershipSource.table, membership, reason, {
          clanId,
          membership: membership.raw_row,
        })
        membershipByPlayer.delete(playerId)
      }
    }
    for (const membership of membershipByPlayer.values()) {
      const [ledger] = await sql<{ outcome: string }[]>`
        SELECT outcome FROM clans.legacy_import_ledger
        WHERE source_table = 'player_clan' AND source_key = ${membership.source_key}
      `
      if (!ledger) {
        await reject(sql, membershipSource.table, membership, reason, {
          clanId,
          membership: membership.raw_row,
        })
      }
    }
    return
  }

  const acceptedMemberChecksums: string[] = []
  for (const member of members) {
    const playerId = member.raw_row.brawlhalla_id
    const [membership] = positiveInteger(playerId)
      ? await readRows(sql, membershipSource, 'WHERE brawlhalla_id = $1', [playerId])
      : []
    let reason: string | null = null
    if (!memberIsValid(member.raw_row)) reason = 'clan-member-invalid'
    else if (positiveInteger(playerId) && duplicatePlayerIds.has(playerId))
      reason = 'legacy-membership-duplicate-roster'
    else if (membership && !membershipAgrees(clanRow.raw_row, member.raw_row, membership.raw_row)) {
      reason = 'legacy-membership-disagreement'
    }
    const [occupied] = positiveInteger(playerId)
      ? await sql<Array<{ owner_success: boolean; legacy_exact: boolean }>>`
          SELECT state.last_success_at IS NOT NULL
                   AND state.last_success_provenance->>'source' = 'v1-guild-members' AS owner_success,
                 member.clan_id = ${clanId}
                   AND member.name = ${String(member.raw_row.name)}
                   AND member.rank = ${String(member.raw_row.rank)}
                   AND member.join_date =
                     (${timestampText(member.raw_row.join_date)}::text::timestamp AT TIME ZONE 'UTC')
                   AND member.xp = ${String(member.raw_row.xp)}
                   AND member.observed_at IS NULL AS legacy_exact
          FROM clans.members member
          LEFT JOIN clans.roster_state state ON state.clan_id = member.clan_id
          WHERE member.brawlhalla_id = ${playerId}
        `
      : []
    if (!reason && occupied?.owner_success) reason = 'destination-owner-membership-preserved'
    else if (!reason && occupied && !occupied.legacy_exact) reason = 'destination-membership-conflict'

    if (reason) {
      await reject(sql, memberSource.table, member, reason, {
        clan: clanRow.raw_row,
        member: member.raw_row,
        membership: membership?.raw_row ?? null,
      })
      if (membership) {
        await reject(sql, membershipSource.table, membership, reason, {
          clan: clanRow.raw_row,
          member: member.raw_row,
          membership: membership.raw_row,
        })
        membershipByPlayer.delete(playerId)
      }
      continue
    }

    if (!occupied) {
      const inserted = await sql<{ brawlhalla_id: number }[]>`
        INSERT INTO clans.members (clan_id, brawlhalla_id, name, rank, join_date, xp, guild_points, observed_at)
        VALUES (${clanId}, ${Number(playerId)}, ${String(member.raw_row.name)}, ${String(member.raw_row.rank)},
                (${timestampText(member.raw_row.join_date)}::text::timestamp AT TIME ZONE 'UTC'),
                ${String(member.raw_row.xp)}, NULL, NULL)
        ON CONFLICT (brawlhalla_id) DO NOTHING
        RETURNING brawlhalla_id
      `
      if (inserted.length !== 1) throw new Error(`Clan member destination changed concurrently for ${playerId}`)
    }
    const memberChecksum = await transform(sql, memberSource.table, member)
    acceptedMemberChecksums.push(memberChecksum)
    if (membership) {
      acceptedMemberChecksums.push(await transform(sql, membershipSource.table, membership))
      membershipByPlayer.delete(playerId)
    }
  }

  for (const membership of membershipByPlayer.values()) {
    const [ledger] = await sql<{ outcome: string }[]>`
      SELECT outcome FROM clans.legacy_import_ledger
      WHERE source_table = 'player_clan' AND source_key = ${membership.source_key}
    `
    if (ledger) continue
    await reject(sql, membershipSource.table, membership, 'legacy-membership-missing-roster', {
      clan: clanRow.raw_row,
      membership: membership.raw_row,
    })
  }

  const rosterProvenance = {
    source: 'legacy-import',
    outcome: 'legacy-unknown',
    sourceTables: ['clan_member', 'player_clan'],
    archiveChecksums: acceptedMemberChecksums.sort(),
  }
  const insertedRosterState = await sql<{ clan_id: number }[]>`
    INSERT INTO clans.roster_state
      (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
    VALUES (${clanId}, NULL, ${sql.json(rosterProvenance)}, NULL, NULL)
    ON CONFLICT DO NOTHING
    RETURNING clan_id
  `
  if (insertedRosterState.length !== 1) throw new Error(`Clan roster destination changed concurrently for ${clanId}`)
}

async function finalizeUnownedRows(sql: Sql): Promise<void> {
  const clanSource = SOURCES[0]
  const memberSource = SOURCES[1]
  const membershipSource = SOURCES[2]
  if (!clanSource || !memberSource || !membershipSource) throw new Error('Clan source registry is invalid')
  while (true) {
    const invalidClans = await sql.unsafe<SourceDatabaseRow[]>(
      `${sourceRowsSql(
        clanSource,
        `WHERE clan_id <= 0 AND NOT EXISTS (
           SELECT 1 FROM clans.legacy_import_ledger ledger
           WHERE ledger.source_table = 'clan' AND ledger.source_key = source.clan_id::text
         )`,
      )} LIMIT 1000`,
    )
    if (invalidClans.length === 0) break
    for (const clan of invalidClans) await processClan(sql, normalizeSourceRow(clan))
  }

  while (true) {
    const remainingMembers = await sql.unsafe<SourceDatabaseRow[]>(
      `${sourceRowsSql(
        memberSource,
        `WHERE NOT EXISTS (
           SELECT 1 FROM clans.legacy_import_ledger ledger
           WHERE ledger.source_table = 'clan_member'
             AND ledger.source_key = source.clan_id::text || ':' || source.brawlhalla_id::text
         )`,
      )} LIMIT 1000`,
    )
    if (remainingMembers.length === 0) break
    for (const databaseRow of remainingMembers) {
      const row = normalizeSourceRow(databaseRow)
      await reject(sql, memberSource.table, row, 'legacy-membership-missing-clan', { member: row.raw_row })
    }
  }

  while (true) {
    const remainingMemberships = await sql.unsafe<SourceDatabaseRow[]>(
      `${sourceRowsSql(
        membershipSource,
        `WHERE NOT EXISTS (
           SELECT 1 FROM clans.legacy_import_ledger ledger
           WHERE ledger.source_table = 'player_clan'
             AND ledger.source_key = source.brawlhalla_id::text
         )`,
      )} LIMIT 1000`,
    )
    if (remainingMemberships.length === 0) break
    for (const databaseRow of remainingMemberships) {
      const row = normalizeSourceRow(databaseRow)
      await reject(sql, membershipSource.table, row, 'legacy-membership-missing-roster', {
        membership: row.raw_row,
      })
    }
  }
}

async function migrationEvidenceIsImmutable(client: Sql): Promise<boolean> {
  const required = new Map([
    ['legacy_archive:clans_legacy_archive_immutable', 'reject_legacy_migration_evidence_change'],
    ['legacy_archive:clans_legacy_archive_prevent_truncate', 'reject_legacy_migration_evidence_change'],
    ['legacy_import_ledger:clans_legacy_import_ledger_immutable', 'reject_legacy_migration_evidence_change'],
    ['legacy_import_ledger:clans_legacy_import_ledger_prevent_truncate', 'reject_legacy_migration_evidence_change'],
    ['legacy_import_rejections:clans_legacy_import_rejections_immutable', 'reject_legacy_migration_evidence_change'],
    [
      'legacy_import_rejections:clans_legacy_import_rejections_prevent_truncate',
      'reject_legacy_migration_evidence_change',
    ],
  ])
  const triggerNames = [...required.keys()].map((key) => key.slice(key.indexOf(':') + 1))
  const rows = await client<Array<{ relation: string; trigger: string; function_name: string }>>`
    SELECT relation.relname AS relation, trigger.tgname AS trigger, function.proname AS function_name
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
    JOIN pg_proc function ON function.oid = trigger.tgfoid
    JOIN pg_namespace function_schema ON function_schema.oid = function.pronamespace
    WHERE relation_schema.nspname = 'clans'
      AND function_schema.nspname = 'clans'
      AND trigger.tgname IN ${client(triggerNames)}
      AND trigger.tgenabled IN ('O', 'A')
      AND NOT trigger.tgisinternal
  `
  const actual = new Map(rows.map((row) => [`${row.relation}:${row.trigger}`, row.function_name]))
  return required.size === actual.size && [...required].every(([key, functionName]) => actual.get(key) === functionName)
}

async function sourceArchiveExact(client: Sql): Promise<boolean> {
  for (const source of SOURCES) {
    const [result] = await client.unsafe<{ exact: boolean }[]>(
      `WITH current_source AS (${sourceRowsSql(source, '', 'source_key')})
       SELECT NOT EXISTS (
         SELECT 1 FROM current_source source
         FULL JOIN (
           SELECT * FROM clans.legacy_archive WHERE source_table = $1
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
      SELECT source_key, row_checksum FROM clans.legacy_archive
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
      transformed: number
      rejected: number
      profiles: number
      members: number
      semantic_exact: boolean
    }>
  >`
    SELECT
      (SELECT count(*)::integer FROM clans.legacy_import_ledger WHERE outcome = 'transformed') AS transformed,
      (SELECT count(*)::integer FROM clans.legacy_import_ledger WHERE outcome = 'rejected') AS rejected,
      (SELECT count(*)::integer FROM clans.legacy_import_ledger
       WHERE source_table = 'clan' AND outcome = 'transformed') AS profiles,
      (SELECT count(*)::integer FROM clans.legacy_import_ledger
       WHERE source_table = 'clan_member' AND outcome = 'transformed') AS members,
      NOT EXISTS (
        SELECT 1 FROM clans.legacy_archive archive
        LEFT JOIN clans.legacy_import_ledger ledger
          ON ledger.source_table = archive.source_table AND ledger.source_key = archive.source_key
        WHERE archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
           OR ledger.source_key IS NULL
           OR ledger.archive_checksum <> archive.row_checksum
      )
      AND NOT EXISTS (
        SELECT 1 FROM clans.legacy_import_ledger ledger
        WHERE ledger.outcome = 'rejected'
          AND NOT EXISTS (
            SELECT 1 FROM clans.legacy_import_rejections rejection
            WHERE rejection.source_table = ledger.source_table
              AND rejection.source_key = ledger.source_key
              AND rejection.archive_checksum = ledger.archive_checksum
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM clans.legacy_import_ledger ledger
        JOIN clans.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN clans.profiles profile ON profile.clan_id = (archive.raw_row->>'clan_id')::integer
        LEFT JOIN clans.profile_state state ON state.clan_id = profile.clan_id
        WHERE ledger.source_table = 'clan' AND ledger.outcome = 'transformed'
          AND NOT (
            (state.last_success_at IS NOT NULL
              AND state.last_success_provenance->>'source' = 'v1-guild-stats')
            OR
            (state.check_provenance->>'source' = 'legacy-import'
              AND state.check_provenance->>'archiveChecksum' = archive.row_checksum
              AND state.checked_at = ((archive.raw_row->>'last_updated')::timestamp AT TIME ZONE 'UTC')
              AND profile.clan_name = archive.raw_row->>'clan_name'
              AND profile.clan_create_date = ((archive.raw_row->>'clan_create_date')::timestamp AT TIME ZONE 'UTC')
              AND profile.clan_xp::text = archive.raw_row->>'clan_xp'
              AND profile.clan_lifetime_xp::text = archive.raw_row->>'clan_lifetime_xp')
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM clans.legacy_import_ledger ledger
        JOIN clans.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN clans.members member
          ON member.clan_id = (archive.raw_row->>'clan_id')::integer
         AND member.brawlhalla_id = (archive.raw_row->>'brawlhalla_id')::integer
        LEFT JOIN clans.roster_state state ON state.clan_id = (archive.raw_row->>'clan_id')::integer
        WHERE ledger.source_table = 'clan_member' AND ledger.outcome = 'transformed'
          AND NOT (
            (state.last_success_at IS NOT NULL
              AND state.last_success_provenance->>'source' = 'v1-guild-members')
            OR
            (state.check_provenance->>'source' = 'legacy-import'
              AND state.check_provenance->'archiveChecksums' ? ledger.archive_checksum
              AND member.observed_at IS NULL
              AND member.name = archive.raw_row->>'name'
              AND member.rank = archive.raw_row->>'rank'
              AND member.join_date = ((archive.raw_row->>'join_date')::timestamp AT TIME ZONE 'UTC')
              AND member.xp::text = archive.raw_row->>'xp')
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM clans.legacy_import_ledger ledger
        JOIN clans.legacy_archive archive
          ON archive.source_table = ledger.source_table AND archive.source_key = ledger.source_key
        LEFT JOIN clans.members member
          ON member.clan_id = (archive.raw_row->>'clan_id')::integer
         AND member.brawlhalla_id = (archive.raw_row->>'brawlhalla_id')::integer
        LEFT JOIN clans.roster_state state ON state.clan_id = (archive.raw_row->>'clan_id')::integer
        WHERE ledger.source_table = 'player_clan' AND ledger.outcome = 'transformed'
          AND NOT (
            (state.last_success_at IS NOT NULL
              AND state.last_success_provenance->>'source' = 'v1-guild-members')
            OR
            (state.check_provenance->>'source' = 'legacy-import'
              AND state.check_provenance->'archiveChecksums' ? ledger.archive_checksum
              AND member.observed_at IS NULL
              AND member.xp::text = archive.raw_row->>'personal_xp')
          )
      ) AS semantic_exact
  `
  const semanticExact =
    (await migrationEvidenceIsImmutable(client)) && (await sourceArchiveExact(client)) && counts.semantic_exact
  const exact =
    manifest.sourceRows === archivedRows &&
    manifest.sourceRows === counts.transformed + counts.rejected &&
    manifest.sourceChecksum === archiveChecksum &&
    semanticExact
  return {
    sourceRows: manifest.sourceRows,
    archivedRows,
    transformedRows: counts.transformed,
    rejectedRows: counts.rejected,
    clanProfiles: counts.profiles,
    members: counts.members,
    sourceChecksum: manifest.sourceChecksum,
    archiveChecksum,
    semanticExact,
    exact,
  }
}

async function lockClanSourcesAndReadManifest(sql: Sql): Promise<SourceManifest> {
  await sql.unsafe('LOCK TABLE public.clan, public.clan_member, public.player_clan IN SHARE MODE')
  return computeSourceManifest(sql)
}

async function blockForSourceChange(client: Sql, progress: ProgressRow): Promise<SourceManifest> {
  const current = await client.begin(async (transaction) => {
    const sql = transaction as unknown as Sql
    const lockedManifest = await lockClanSourcesAndReadManifest(sql)
    await sql`
      UPDATE clans.legacy_import_progress
      SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
      WHERE singleton
    `
    await sql`
      INSERT INTO clans.legacy_import_rejections
        (source_table, source_key, code, evidence, archive_checksum)
      VALUES ('manifest', ${lockedManifest.sourceChecksum}, 'source-manifest-changed',
              ${sql.json(jsonValue({ frozen: progress.source_manifest, current: lockedManifest }))},
              ${lockedManifest.sourceChecksum})
      ON CONFLICT DO NOTHING
    `
    return lockedManifest
  })
  progress.status = 'blocked'
  return current
}

async function persistImmutabilityBlock(sql: Sql, manifest: SourceManifest): Promise<void> {
  await sql`
    UPDATE clans.legacy_import_progress
    SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
    WHERE singleton
  `
  await sql`
    INSERT INTO clans.legacy_import_rejections
      (source_table, source_key, code, evidence, archive_checksum)
    VALUES ('manifest', ${manifest.sourceChecksum}, 'destination-immutability-unavailable',
            ${sql.json(jsonValue({ required: 'clans-legacy-evidence-triggers' }))},
            ${manifest.sourceChecksum})
    ON CONFLICT DO NOTHING
  `
}

export async function importLegacyClans(
  connectionString: string,
  options: LegacyClanImportOptions = {},
): Promise<LegacyClanImportResult> {
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
      lockClanSourcesAndReadManifest(transaction as unknown as Sql),
    )
    let [progress] = await client<ProgressRow[]>`
      SELECT status, last_clan_id, source_manifest, source_checksum
      FROM clans.legacy_import_progress WHERE singleton
    `
    if (!progress) {
      ;[progress] = await client<ProgressRow[]>`
        INSERT INTO clans.legacy_import_progress
          (status, stage, source_manifest, source_checksum)
        VALUES ('in-progress', 'clans', ${client.json(manifest)}, ${manifest.sourceChecksum})
        RETURNING status, last_clan_id, source_manifest, source_checksum
      `
    } else if (
      progress.source_checksum.trim() !== manifest.sourceChecksum ||
      stableJson(progress.source_manifest) !== stableJson(manifest)
    ) {
      const blockedManifest = await blockForSourceChange(client, progress)
      return {
        status: 'blocked',
        checkpoint:
          progress.last_clan_id === null ? null : { stage: 'clans', sourceKey: String(progress.last_clan_id) },
        reconciliation: await reconcile(client, blockedManifest),
      }
    }
    if (progress.status === 'blocked') {
      return {
        status: 'blocked',
        checkpoint:
          progress.last_clan_id === null ? null : { stage: 'clans', sourceKey: String(progress.last_clan_id) },
        reconciliation: await reconcile(client, manifest),
      }
    }
    if (!(await migrationEvidenceIsImmutable(client))) {
      await client.begin(async (transaction) => persistImmutabilityBlock(transaction as unknown as Sql, manifest))
      progress.status = 'blocked'
      return {
        status: 'blocked',
        checkpoint: null,
        reconciliation: await reconcile(client, manifest),
      }
    }
    const duplicateManifest = await client.begin(async (transaction) => {
      const sql = transaction as unknown as Sql
      const currentManifest = await lockClanSourcesAndReadManifest(sql)
      if (stableJson(currentManifest) !== stableJson(progress.source_manifest)) return currentManifest
      await sql.unsafe(`
        CREATE TEMP TABLE legacy_clan_duplicate_members ON COMMIT PRESERVE ROWS AS
        SELECT brawlhalla_id FROM public.clan_member
        GROUP BY brawlhalla_id HAVING count(*) <> 1;
        CREATE UNIQUE INDEX ON legacy_clan_duplicate_members (brawlhalla_id);
      `)
      return null
    })
    if (duplicateManifest) {
      const blockedManifest = await blockForSourceChange(client, progress)
      return {
        status: 'blocked',
        checkpoint:
          progress.last_clan_id === null ? null : { stage: 'clans', sourceKey: String(progress.last_clan_id) },
        reconciliation: await reconcile(client, blockedManifest),
      }
    }

    let cursor = progress.last_clan_id
    let batches = 0
    let completed = progress.status === 'complete'
    const clanSource = SOURCES[0]
    if (!clanSource) throw new Error('Clan source registry is empty')
    while (!completed && batches < maxBatches) {
      const result = await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        const currentManifest = await lockClanSourcesAndReadManifest(sql)
        if (stableJson(currentManifest) !== stableJson(progress.source_manifest)) {
          return { outcome: 'source-changed' as const, currentManifest }
        }
        if (!(await migrationEvidenceIsImmutable(sql))) {
          await persistImmutabilityBlock(sql, currentManifest)
          return { outcome: 'immutability-unavailable' as const }
        }
        const rows = await sql.unsafe<SourceDatabaseRow[]>(
          `${sourceRowsSql(
            clanSource,
            'WHERE clan_id > 0 AND ($1::integer IS NULL OR clan_id > $1::integer)',
            'clan_id',
          )} LIMIT $2`,
          [cursor, batchSize],
        )
        const clans = rows.map(normalizeSourceRow)
        if (clans.length === 0) {
          await finalizeUnownedRows(sql)
          await sql`
            UPDATE clans.legacy_import_progress
            SET status = 'complete', completed_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE singleton
          `
          return { outcome: 'complete' as const }
        }
        for (const clan of clans) await processClan(sql, clan)
        const lastClanId = Number(clans.at(-1)?.raw_row.clan_id)
        await sql`
          UPDATE clans.legacy_import_progress
          SET status = 'in-progress', last_clan_id = ${lastClanId}, updated_at = clock_timestamp()
          WHERE singleton
        `
        return { outcome: 'batch' as const, lastClanId }
      })
      if (result.outcome === 'source-changed') {
        const blockedManifest = await blockForSourceChange(client, progress)
        return {
          status: 'blocked',
          checkpoint: cursor === null ? null : { stage: 'clans', sourceKey: String(cursor) },
          reconciliation: await reconcile(client, blockedManifest),
        }
      }
      if (result.outcome === 'immutability-unavailable') {
        progress.status = 'blocked'
        return {
          status: 'blocked',
          checkpoint: cursor === null ? null : { stage: 'clans', sourceKey: String(cursor) },
          reconciliation: await reconcile(client, progress.source_manifest),
        }
      }
      if (result.outcome === 'complete') {
        completed = true
        break
      }
      cursor = result.lastClanId
      batches += 1
    }

    const reconciliation = await reconcile(client, manifest)
    if (completed && !reconciliation.exact) {
      await client`
        UPDATE clans.legacy_import_progress
        SET status = 'blocked', completed_at = NULL, updated_at = clock_timestamp()
        WHERE singleton
      `
      return {
        status: 'blocked',
        checkpoint: cursor === null ? null : { stage: 'clans', sourceKey: String(cursor) },
        reconciliation,
      }
    }
    return {
      status: completed ? 'complete' : 'in-progress',
      checkpoint: completed || cursor === null ? null : { stage: 'clans', sourceKey: String(cursor) },
      reconciliation,
    }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
