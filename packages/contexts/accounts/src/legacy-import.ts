import { createHash } from 'node:crypto'
import postgres, { type JSONValue } from 'postgres'
import { finalizeV2AuthCutoverTransaction } from './finalize-v2-auth-cutover'
import { ACCOUNTS_WRITER_MAINTENANCE_FENCE } from './maintenance-fence'
const DEFAULT_BATCH_SIZE = 500
const MANIFEST_VERSION = 1
const AUDIT_ATTESTATION_VERSION = 2

type Sql = ReturnType<typeof postgres>
type RawRow = Record<string, unknown>
type ImportStage = 'users' | 'oauth-identities' | 'sessions' | 'player-links' | 'finalize'
type ImportStatus = 'complete' | 'in-progress' | 'blocked'
type SourceDefinition = {
  table: 'user' | 'oauth_account' | 'session' | 'player_link'
  tableSql: string
  stage: Exclude<ImportStage, 'finalize'>
  keyExpression: string
}
type SourceDatabaseRow = {
  source_key: string
  raw_json: string
}
type SourceRow = {
  sourceKey: string
  rawRow: RawRow
  sourceChecksum: string
  contentValue: JSONValue
  contentChecksum: string
  secretEvidence: Record<string, unknown>
}
type SourceManifest = {
  version: typeof MANIFEST_VERSION
  rowCounts: Record<string, number>
  sourceRows: number
  sourceChecksum: string
  archiveChecksum: string
}
type ProgressRow = {
  status: ImportStatus
  stage: ImportStage
  last_source_key: string | null
  source_manifest: SourceManifest
  source_checksum: string
  session_cutoff_at: Date
  block_reason: Record<string, unknown> | null
  reconciliation: StoredReconciliation | null
}
type LinkAttemptRow = {
  id: string
  account_id: string
  proof_subject: string
  started_at: Date
  status: 'pending' | 'failed' | 'conflict' | 'verified'
  completed_at: Date | null
  brawlhalla_id: number | null
  player_name: string | null
  evidence_source: string | null
  evidence_checked_at: Date | null
}
class FinalizationBlockedError extends Error {
  constructor(readonly reason: Record<string, unknown>) {
    super('Accounts import finalization blocked')
  }
}

type BatchResult =
  | { kind: 'source-changed'; manifest: SourceManifest }
  | { kind: 'advanced'; progress: ProgressRow | undefined }
  | { kind: 'batch'; progress: ProgressRow | undefined }
  | { kind: 'blocked'; result: LegacyAccountsImportResult }

export type LegacyAccountsReconciliation = {
  sourceRows: number
  archivedRows: number
  transformedRows: number
  rejectedRows: number
  preservedUsers: number
  preservedOAuthIdentities: number
  preservedValidSessions: number
  preservedAttempts: number
  primaryPlayers: number
  sourceChecksum: string
  archiveChecksum: string
  semanticExact: boolean
  exact: boolean
}
type Reconciliation = LegacyAccountsReconciliation
type StoredReconciliation = Reconciliation & {
  auditEventCount?: number
  auditChecksum?: string
}

export type LegacyAccountsImportResult = {
  status: ImportStatus
  checkpoint: { stage: ImportStage; sourceKey: string | null } | null
  reconciliation: LegacyAccountsReconciliation
}

export type LegacyAccountsImportOptions = {
  legacyWritersQuiesced: true
  batchSize?: number
  maxBatches?: number
}

const SOURCES: readonly SourceDefinition[] = [
  { table: 'user', tableSql: '"user"', stage: 'users', keyExpression: 'id::text' },
  {
    table: 'oauth_account',
    tableSql: 'oauth_account',
    stage: 'oauth-identities',
    keyExpression: 'jsonb_build_array(provider, provider_account_id)::text',
  },
  { table: 'session', tableSql: 'session', stage: 'sessions', keyExpression: 'id' },
  { table: 'player_link', tableSql: 'player_link', stage: 'player-links', keyExpression: 'user_id::text' },
]

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

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function jsonValue(value: unknown): JSONValue {
  return JSON.parse(stableJson(value)) as JSONValue
}

function addChecksumFrame(hash: ReturnType<typeof createHash>, table: string, key: string, rowChecksum: string): void {
  hash.update(`${table.length}:${table}${key.length}:${key}${rowChecksum}`)
}

function parseRawJson(rawJson: string): RawRow {
  const parsed: unknown = JSON.parse(rawJson)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Legacy Accounts row is not an object')
  return parsed as RawRow
}

function redactRow(
  table: SourceDefinition['table'],
  rawRow: RawRow,
): {
  content: RawRow
  secretEvidence: Record<string, unknown>
} {
  const content = { ...rawRow }
  if (table === 'oauth_account') {
    const refreshToken = rawRow.refresh_token
    content.refresh_token = refreshToken === null ? null : '[REDACTED]'
    return {
      content,
      secretEvidence: {
        refreshTokenPresent: typeof refreshToken === 'string',
        ...(typeof refreshToken === 'string' ? { refreshTokenSha256: checksum(refreshToken) } : {}),
      },
    }
  }
  if (table === 'player_link') {
    const steamId = rawRow.steam_id
    content.steam_id = '[REDACTED]'
    return {
      content,
      secretEvidence: {
        steamIdPresent: typeof steamId === 'string',
        ...(typeof steamId === 'string' ? { steamIdSha256: checksum(steamId) } : {}),
      },
    }
  }
  return { content, secretEvidence: {} }
}

function normalizeSourceRow(table: SourceDefinition['table'], row: SourceDatabaseRow): SourceRow {
  const rawRow = parseRawJson(row.raw_json)
  const { content, secretEvidence } = redactRow(table, rawRow)
  const contentValue = jsonValue(content)
  return {
    sourceKey: row.source_key,
    rawRow,
    sourceChecksum: checksum(row.raw_json),
    contentValue,
    contentChecksum: checksum(stableJson(contentValue)),
    secretEvidence,
  }
}

function sourceRowsSql(source: SourceDefinition, predicate = '', order = 'source_key'): string {
  return `SELECT ${source.keyExpression} AS source_key, to_jsonb(source)::text AS raw_json
    FROM public.${source.tableSql} source ${predicate} ORDER BY ${order}`
}

function validateOptions(options: LegacyAccountsImportOptions): { batchSize: number; maxBatches: number } {
  if (options.legacyWritersQuiesced !== true) throw new Error('Legacy Accounts writers must be quiescent before import')
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000)
    throw new Error('batchSize must be 1..10000')
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches }
}

async function lockSources(sql: Sql): Promise<void> {
  const [availability] = await sql.unsafe<{ available: boolean }[]>(
    `SELECT to_regclass('public."user"') IS NOT NULL
        AND to_regclass('public.oauth_account') IS NOT NULL
        AND to_regclass('public.session') IS NOT NULL
        AND to_regclass('public.player_link') IS NOT NULL AS available`,
  )
  if (!availability.available) throw new Error('All four V2 Accounts source tables must remain available')
  await sql.unsafe('LOCK TABLE public."user", public.oauth_account, public.session, public.player_link IN SHARE MODE')
}

async function computeSourceManifest(sql: Sql): Promise<SourceManifest> {
  const sourceHash = createHash('sha256')
  const archiveHash = createHash('sha256')
  const rowCounts: Record<string, number> = {}
  let sourceRows = 0
  for (const source of SOURCES) {
    let count = 0
    for await (const rows of sql.unsafe<SourceDatabaseRow[]>(sourceRowsSql(source)).cursor(1_000)) {
      for (const databaseRow of rows) {
        const row = normalizeSourceRow(source.table, databaseRow)
        addChecksumFrame(sourceHash, source.table, row.sourceKey, row.sourceChecksum)
        addChecksumFrame(archiveHash, source.table, row.sourceKey, row.contentChecksum)
        count += 1
      }
    }
    rowCounts[source.table] = count
    sourceRows += count
  }
  return {
    version: MANIFEST_VERSION,
    rowCounts,
    sourceRows,
    sourceChecksum: sourceHash.digest('hex'),
    archiveChecksum: archiveHash.digest('hex'),
  }
}

function manifestsMatch(left: SourceManifest, right: SourceManifest): boolean {
  return stableJson(left) === stableJson(right)
}

async function archiveRow(sql: Sql, source: SourceDefinition, row: SourceRow): Promise<void> {
  const accountId = source.table === 'user' ? row.rawRow.id : row.rawRow.user_id
  await sql`
    INSERT INTO accounts.legacy_archive (
      source_table, source_key, account_id, raw_row, secret_evidence, source_row_checksum, content_checksum
    ) VALUES (
      ${source.table}, ${row.sourceKey}, ${typeof accountId === 'string' ? accountId : null},
      ${sql.json(row.contentValue)}, ${sql.json(jsonValue(row.secretEvidence))}, ${row.sourceChecksum}, ${row.contentChecksum}
    )
    ON CONFLICT (source_table, source_key) DO NOTHING
  `
  const [stored] = await sql<Array<{ source_row_checksum: string; content_checksum: string }>>`
    SELECT source_row_checksum, content_checksum
    FROM accounts.legacy_archive
    WHERE source_table = ${source.table} AND source_key = ${row.sourceKey}
  `
  if (
    !stored ||
    stored.source_row_checksum.trim() !== row.sourceChecksum ||
    stored.content_checksum.trim() !== row.contentChecksum
  ) {
    throw new Error(`Immutable Accounts archive conflicts with ${source.table}/${row.sourceKey}`)
  }
}

async function recordLedger(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
  outcome: 'transformed' | 'rejected',
  destinationKind: string | null,
  destinationKey: string | null,
): Promise<void> {
  await sql`
    INSERT INTO accounts.legacy_import_ledger (
      source_table, source_key, archive_content_checksum, outcome, destination_kind, destination_key
    ) VALUES (
      ${source.table}, ${row.sourceKey}, ${row.contentChecksum}, ${outcome}, ${destinationKind}, ${destinationKey}
    )
    ON CONFLICT (source_table, source_key) DO NOTHING
  `
}

async function rejectRow(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
  code: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  await sql`
    INSERT INTO accounts.legacy_import_rejections (
      source_table, source_key, code, evidence, archive_content_checksum
    ) VALUES (${source.table}, ${row.sourceKey}, ${code}, ${sql.json(jsonValue(evidence))}, ${row.contentChecksum})
    ON CONFLICT (source_table, source_key, code) DO NOTHING
  `
  await recordLedger(sql, source, row, 'rejected', null, null)
}

function text(raw: RawRow, key: string): string | null {
  return typeof raw[key] === 'string' ? raw[key] : null
}

function positiveBrawlhallaId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647
}

type LegacyPlayerLinkClassification = {
  status: 'linked' | 'pending' | 'failed' | 'conflict'
  playerId: number | null
}

function classifyLegacyPlayerLink(status: string | null, rawPlayerId: unknown): LegacyPlayerLinkClassification | null {
  if (status === 'linked') {
    return positiveBrawlhallaId(rawPlayerId) ? { status, playerId: rawPlayerId } : null
  }
  if (status === 'conflict') {
    if (rawPlayerId !== null && !positiveBrawlhallaId(rawPlayerId)) return null
    return { status, playerId: rawPlayerId }
  }
  if (status === 'pending' || status === 'failed') return { status, playerId: null }
  return null
}

async function transformUser(sql: Sql, source: SourceDefinition, row: SourceRow): Promise<null> {
  const id = text(row.rawRow, 'id')
  const createdAt = text(row.rawRow, 'created_at')
  const updatedAt = text(row.rawRow, 'updated_at')
  if (!id || !createdAt || !updatedAt) throw new Error(`Invalid V2 user ${row.sourceKey}`)
  await sql.unsafe(
    `INSERT INTO accounts.users (id, created_at, updated_at)
     VALUES ($1, $2::text::timestamp AT TIME ZONE 'UTC', $3::text::timestamp AT TIME ZONE 'UTC')
     ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
    [id, createdAt, updatedAt],
  )
  await recordLedger(sql, source, row, 'transformed', 'user', id)
  return null
}

async function transformOAuthIdentity(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
): Promise<Record<string, unknown> | null> {
  const provider = text(row.rawRow, 'provider')
  const providerAccountId = text(row.rawRow, 'provider_account_id')
  const accountId = text(row.rawRow, 'user_id')
  const displayName = text(row.rawRow, 'username')
  const createdAt = text(row.rawRow, 'created_at')
  const updatedAt = text(row.rawRow, 'updated_at')
  const avatarHash = row.rawRow.avatar_hash === null ? null : text(row.rawRow, 'avatar_hash')
  const refreshToken = row.rawRow.refresh_token === null ? null : text(row.rawRow, 'refresh_token')
  if (!provider || !providerAccountId || !accountId || !displayName || !createdAt || !updatedAt) {
    await rejectRow(sql, source, row, 'invalid-oauth-identity', { reason: 'required-field-invalid' })
    return { code: 'invalid-oauth-identity', sourceTable: source.table, sourceKey: row.sourceKey }
  }
  const [conflict] = await sql.unsafe<{ conflicted: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM accounts.oauth_identities
       WHERE (provider = $1 AND provider_account_id = $2 AND account_id <> $3::uuid)
          OR (account_id = $3::uuid AND provider = $1 AND provider_account_id <> $2)
     ) AS conflicted`,
    [provider, providerAccountId, accountId],
  )
  if (conflict.conflicted) {
    await rejectRow(sql, source, row, 'identity-ownership-conflict', { reason: 'oauth-owner-mismatch' })
    return { code: 'identity-ownership-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
  }
  await sql.unsafe(
    `INSERT INTO accounts.oauth_identities (
       provider, provider_account_id, account_id, display_name, avatar_hash, refresh_token, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::text::timestamp AT TIME ZONE 'UTC', $8::text::timestamp AT TIME ZONE 'UTC')
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       display_name = EXCLUDED.display_name,
       avatar_hash = EXCLUDED.avatar_hash,
       refresh_token = EXCLUDED.refresh_token,
       created_at = EXCLUDED.created_at,
       updated_at = EXCLUDED.updated_at`,
    [provider, providerAccountId, accountId, displayName, avatarHash, refreshToken, createdAt, updatedAt],
  )
  await recordLedger(sql, source, row, 'transformed', 'oauth-identity', `${provider}/${providerAccountId}`)
  return null
}

async function transformSession(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
  cutoff: Date,
): Promise<Record<string, unknown> | null> {
  const id = text(row.rawRow, 'id')
  const accountId = text(row.rawRow, 'user_id')
  const expiresAt = text(row.rawRow, 'expires_at')
  const createdAt = text(row.rawRow, 'created_at')
  if (!id || !accountId || !expiresAt || !createdAt) {
    await rejectRow(sql, source, row, 'invalid-session', { reason: 'required-field-invalid' })
    return { code: 'invalid-session', sourceTable: source.table, sourceKey: row.sourceKey }
  }
  const [validity] = await sql.unsafe<{ valid: boolean; has_identity: boolean }[]>(
    `SELECT
       $1::text::timestamp AT TIME ZONE 'UTC' > $2::timestamptz AS valid,
       EXISTS (SELECT 1 FROM accounts.oauth_identities WHERE account_id = $3::uuid) AS has_identity`,
    [expiresAt, cutoff, accountId],
  )
  if (!validity.valid) {
    await rejectRow(sql, source, row, 'expired-session', { reason: 'expired-at-cutoff' })
    return null
  }
  if (!validity.has_identity) {
    await rejectRow(sql, source, row, 'orphan-session', { reason: 'account-has-no-oauth-identity' })
    return null
  }
  const [collision] = await sql.unsafe<{ conflicted: boolean }[]>(
    'SELECT EXISTS (SELECT 1 FROM accounts.sessions WHERE id = $1 AND account_id <> $2::uuid) AS conflicted',
    [id, accountId],
  )
  if (collision.conflicted) {
    await rejectRow(sql, source, row, 'identity-ownership-conflict', { reason: 'session-owner-mismatch' })
    return { code: 'identity-ownership-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
  }
  await sql.unsafe(
    `INSERT INTO accounts.sessions (id, account_id, expires_at, created_at, imported_from_v2)
     VALUES ($1, $2, $3::text::timestamp AT TIME ZONE 'UTC', $4::text::timestamp AT TIME ZONE 'UTC', true)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       expires_at = EXCLUDED.expires_at,
       created_at = EXCLUDED.created_at,
       imported_from_v2 = true`,
    [id, accountId, expiresAt, createdAt],
  )
  await recordLedger(sql, source, row, 'transformed', 'session', id)
  return null
}

async function loadAttempt(sql: Sql, idempotencyKey: string): Promise<LinkAttemptRow | null> {
  const [attempt] = await sql.unsafe<LinkAttemptRow[]>(
    `SELECT attempt.id, attempt.account_id::text, attempt.proof_subject, attempt.started_at,
            COALESCE(outcome.status, 'pending') AS status, outcome.completed_at,
            outcome.brawlhalla_id::integer, outcome.player_name, outcome.evidence_source, outcome.evidence_checked_at
     FROM accounts.primary_player_verification_attempts attempt
     LEFT JOIN accounts.primary_player_verification_outcomes outcome ON outcome.attempt_id = attempt.id
     WHERE attempt.idempotency_key = $1`,
    [idempotencyKey],
  )
  return attempt ?? null
}

async function transformPlayerLink(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
): Promise<Record<string, unknown> | null> {
  const accountId = text(row.rawRow, 'user_id')
  const steamId = text(row.rawRow, 'steam_id')
  const linkedVia = text(row.rawRow, 'linked_via')
  const classification = classifyLegacyPlayerLink(text(row.rawRow, 'status'), row.rawRow.brawlhalla_id)
  const linkedAt = text(row.rawRow, 'linked_at')
  const [account] = accountId
    ? await sql.unsafe<{ exists: boolean }[]>(
        'SELECT EXISTS (SELECT 1 FROM accounts.users WHERE id = $1::uuid) AS exists',
        [accountId],
      )
    : [{ exists: false }]
  if (!accountId || !steamId || linkedVia !== 'steam' || !linkedAt || !classification || !account.exists) {
    await rejectRow(sql, source, row, 'invalid-player-link', { reason: 'unsupported-or-malformed-link' })
    return null
  }

  const { status, playerId } = classification
  const idempotencyKey = `legacy:${accountId}`
  let attempt = await loadAttempt(sql, idempotencyKey)
  if (attempt && attempt.proof_subject !== steamId) {
    await rejectRow(sql, source, row, 'immutable-verification-conflict', { reason: 'proof-subject-mismatch' })
    return { code: 'immutable-verification-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
  }
  if (!attempt) {
    await sql.unsafe(
      `INSERT INTO accounts.primary_player_verification_attempts (
         id, account_id, proof_provider, proof_subject, idempotency_key, started_at
       ) VALUES (gen_random_uuid(), $1, 'steam', $2, $3, $4::text::timestamp AT TIME ZONE 'UTC')`,
      [accountId, steamId, idempotencyKey, linkedAt],
    )
    attempt = await loadAttempt(sql, idempotencyKey)
  }
  if (!attempt) throw new Error('Failed to persist legacy verification attempt')

  let desiredStatus: LinkAttemptRow['status'] = status === 'linked' ? 'verified' : status
  if (status === 'linked') {
    const [duplicates] = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::integer AS count
       FROM public.player_link
       WHERE status = 'linked' AND brawlhalla_id = $1`,
      [playerId],
    )
    desiredStatus = duplicates.count === 1 ? 'verified' : 'conflict'
  }

  if (attempt.status !== 'pending') {
    if (attempt.status !== desiredStatus || attempt.brawlhalla_id !== playerId) {
      await rejectRow(sql, source, row, 'immutable-verification-conflict', { reason: 'outcome-mismatch' })
      return { code: 'immutable-verification-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
    }
  } else if (desiredStatus !== 'pending') {
    if (desiredStatus === 'verified') {
      const owners = await sql.unsafe<Array<{ account_id: string; brawlhalla_id: number }>>(
        `SELECT account_id::text, brawlhalla_id::integer
         FROM accounts.primary_players
         WHERE account_id = $1::uuid OR brawlhalla_id = $2
         FOR UPDATE`,
        [accountId, playerId],
      )
      const conflict = owners.some((owner) => owner.account_id !== accountId || owner.brawlhalla_id !== playerId)
      if (conflict) {
        await rejectRow(sql, source, row, 'primary-ownership-conflict', { reason: 'destination-owner-mismatch' })
        return { code: 'primary-ownership-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
      }
    }

    if (desiredStatus === 'failed' || (desiredStatus === 'conflict' && playerId === null)) {
      await sql.unsafe(
        `INSERT INTO accounts.primary_player_verification_outcomes (attempt_id, status, completed_at)
         VALUES ($1, $2, $3::text::timestamp AT TIME ZONE 'UTC')`,
        [attempt.id, desiredStatus, linkedAt],
      )
    } else {
      await sql.unsafe(
        `INSERT INTO accounts.primary_player_verification_outcomes (
           attempt_id, status, brawlhalla_id, evidence_source, evidence_checked_at, completed_at
         ) VALUES ($1, $2, $3, 'legacy-steam-link', $4::text::timestamp AT TIME ZONE 'UTC', $4::text::timestamp AT TIME ZONE 'UTC')`,
        [attempt.id, desiredStatus, playerId, linkedAt],
      )
    }
  }

  if (desiredStatus === 'verified') {
    const [existingPrimary] = await sql.unsafe<
      Array<{ account_id: string; brawlhalla_id: number; attempt_id: string }>
    >(
      `SELECT account_id::text, brawlhalla_id::integer, verification_attempt_id::text AS attempt_id
       FROM accounts.primary_players
       WHERE account_id = $1::uuid OR brawlhalla_id = $2`,
      [accountId, playerId],
    )
    if (
      existingPrimary &&
      (existingPrimary.account_id !== accountId ||
        existingPrimary.brawlhalla_id !== playerId ||
        existingPrimary.attempt_id !== attempt.id)
    ) {
      await rejectRow(sql, source, row, 'primary-ownership-conflict', { reason: 'immutable-primary-mismatch' })
      return { code: 'primary-ownership-conflict', sourceTable: source.table, sourceKey: row.sourceKey }
    }
    if (!existingPrimary) {
      await sql.unsafe(
        `INSERT INTO accounts.primary_players (
           account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id
         ) VALUES ($1, $2, NULL, $3::text::timestamp AT TIME ZONE 'UTC', $4)`,
        [accountId, playerId, linkedAt, attempt.id],
      )
    }
  }

  await recordLedger(sql, source, row, 'transformed', 'verification-attempt', idempotencyKey)
  return null
}

async function transformRow(
  sql: Sql,
  source: SourceDefinition,
  row: SourceRow,
  cutoff: Date,
): Promise<Record<string, unknown> | null> {
  if (source.table === 'user') return transformUser(sql, source, row)
  if (source.table === 'oauth_account') return transformOAuthIdentity(sql, source, row)
  if (source.table === 'session') return transformSession(sql, source, row, cutoff)
  return transformPlayerLink(sql, source, row)
}

async function sourceArchiveExact(sql: Sql): Promise<boolean> {
  for (const source of SOURCES) {
    const [comparison] = await sql.unsafe<Array<{ exact: boolean }>>(
      `SELECT NOT EXISTS (
         SELECT 1
         FROM (${sourceRowsSql(source)}) current_source
         FULL JOIN (
           SELECT source_key, source_row_checksum
           FROM accounts.legacy_archive WHERE source_table = $1
         ) archive USING (source_key)
         WHERE current_source.source_key IS NULL
            OR archive.source_key IS NULL
            OR archive.source_row_checksum <> encode(
              sha256(convert_to(current_source.raw_json, 'UTF8')), 'hex'
            )
       ) AS exact`,
      [source.table],
    )
    if (!comparison?.exact) return false
  }
  return true
}

async function readArchiveState(sql: Sql): Promise<{ checksum: string; mismatches: number }> {
  const hash = createHash('sha256')
  let mismatches = 0
  for (const source of SOURCES) {
    const query = sql.unsafe<Array<{ source_key: string; raw_row: RawRow; content_checksum: string }>>(
      `SELECT source_key, raw_row, content_checksum
       FROM accounts.legacy_archive
       WHERE source_table = $1
       ORDER BY source_key`,
      [source.table],
    )
    for await (const rows of query.cursor(1_000)) {
      for (const row of rows) {
        const storedChecksum = row.content_checksum.trim()
        if (checksum(stableJson(row.raw_row)) !== storedChecksum) mismatches += 1
        addChecksumFrame(hash, source.table, row.source_key, storedChecksum)
      }
    }
  }
  return { checksum: hash.digest('hex'), mismatches }
}

function legacyTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/u, '')}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

async function reconcilePlayerLinks(sql: Sql): Promise<{ expectedAttempts: number; mismatches: number }> {
  let expectedAttempts = 0
  let mismatches = 0
  const source = SOURCES.find(({ table }) => table === 'player_link')
  if (!source) throw new Error('Player-link source is unavailable')
  for await (const rows of sql.unsafe<SourceDatabaseRow[]>(sourceRowsSql(source)).cursor(1_000)) {
    for (const databaseRow of rows) {
      const row = normalizeSourceRow(source.table, databaseRow)
      const accountId = text(row.rawRow, 'user_id')
      const steamId = text(row.rawRow, 'steam_id')
      const linkedVia = text(row.rawRow, 'linked_via')
      const classification = classifyLegacyPlayerLink(text(row.rawRow, 'status'), row.rawRow.brawlhalla_id)
      const linkedAt = legacyTimestamp(row.rawRow.linked_at)
      if (!accountId || !steamId || linkedVia !== 'steam' || linkedAt === null || !classification) continue
      const { status, playerId } = classification
      expectedAttempts += 1
      const attempt = await loadAttempt(sql, `legacy:${accountId}`)
      if (
        !attempt ||
        attempt.account_id !== accountId ||
        attempt.proof_subject !== steamId ||
        attempt.started_at.getTime() !== linkedAt
      ) {
        mismatches += 1
        continue
      }
      let expectedStatus: LinkAttemptRow['status'] = status === 'linked' ? 'verified' : status
      if (status === 'linked') {
        const [duplicates] = await sql.unsafe<{ count: number }[]>(
          `SELECT count(*)::integer AS count FROM public.player_link
           WHERE status = 'linked' AND brawlhalla_id = $1`,
          [playerId],
        )
        expectedStatus = duplicates.count === 1 ? 'verified' : 'conflict'
      }
      const terminalAt = attempt.completed_at?.getTime() ?? null
      const evidenceCheckedAt = attempt.evidence_checked_at?.getTime() ?? null
      const expectsPlayerEvidence =
        (expectedStatus === 'verified' || expectedStatus === 'conflict') && playerId !== null
      if (
        attempt.status !== expectedStatus ||
        attempt.brawlhalla_id !== playerId ||
        attempt.player_name !== null ||
        terminalAt !== (expectedStatus === 'pending' ? null : linkedAt) ||
        attempt.evidence_source !== (expectsPlayerEvidence ? 'legacy-steam-link' : null) ||
        evidenceCheckedAt !== (expectsPlayerEvidence ? linkedAt : null)
      ) {
        mismatches += 1
        continue
      }
      if (expectedStatus === 'verified') {
        const [primary] = await sql.unsafe<Array<{ exact: boolean }>>(
          `SELECT EXISTS (
             SELECT 1 FROM accounts.primary_players
             WHERE account_id = $1::uuid AND brawlhalla_id = $2 AND verification_attempt_id = $3::uuid
           ) AS exact`,
          [accountId, playerId, attempt.id],
        )
        if (!primary.exact) mismatches += 1
      }
    }
  }
  return { expectedAttempts, mismatches }
}

async function rejectionEvidenceExact(sql: Sql, cutoff: Date): Promise<boolean> {
  const rejectedLedgerRows = await sql<Array<{ source_table: string; source_key: string }>>`
    SELECT source_table, source_key
    FROM accounts.legacy_import_ledger
    WHERE outcome = 'rejected'
  `
  const rejectedSourceKeys = new Set(
    rejectedLedgerRows.map(({ source_table, source_key }) => `${source_table}:${source_key}`),
  )
  const expected = new Map<string, string>()
  const addExpected = (
    sourceTable: SourceDefinition['table'],
    row: SourceRow,
    code: string,
    evidence: Record<string, unknown>,
  ) => {
    expected.set(
      `${sourceTable}:${row.sourceKey}`,
      stableJson({ code, evidence, archiveContentChecksum: row.contentChecksum }),
    )
  }

  const sessionSource = SOURCES.find(({ table }) => table === 'session')
  const playerLinkSource = SOURCES.find(({ table }) => table === 'player_link')
  if (!sessionSource || !playerLinkSource) throw new Error('Accounts rejection sources are unavailable')

  for await (const rows of sql.unsafe<SourceDatabaseRow[]>(sourceRowsSql(sessionSource)).cursor(1_000)) {
    for (const databaseRow of rows) {
      const row = normalizeSourceRow(sessionSource.table, databaseRow)
      if (!rejectedSourceKeys.has(`${sessionSource.table}:${row.sourceKey}`)) continue
      const id = text(row.rawRow, 'id')
      const accountId = text(row.rawRow, 'user_id')
      const expiresAt = text(row.rawRow, 'expires_at')
      const createdAt = text(row.rawRow, 'created_at')
      if (!id || !accountId || !expiresAt || !createdAt) {
        addExpected(sessionSource.table, row, 'invalid-session', { reason: 'required-field-invalid' })
        continue
      }
      const [validity] = await sql.unsafe<{ valid: boolean; has_identity: boolean }[]>(
        `SELECT
           $1::text::timestamp AT TIME ZONE 'UTC' > $2::timestamptz AS valid,
           EXISTS (SELECT 1 FROM accounts.oauth_identities WHERE account_id = $3::uuid) AS has_identity`,
        [expiresAt, cutoff, accountId],
      )
      if (!validity.valid) {
        addExpected(sessionSource.table, row, 'expired-session', { reason: 'expired-at-cutoff' })
      } else if (!validity.has_identity) {
        addExpected(sessionSource.table, row, 'orphan-session', { reason: 'account-has-no-oauth-identity' })
      }
    }
  }

  for await (const rows of sql.unsafe<SourceDatabaseRow[]>(sourceRowsSql(playerLinkSource)).cursor(1_000)) {
    for (const databaseRow of rows) {
      const row = normalizeSourceRow(playerLinkSource.table, databaseRow)
      if (!rejectedSourceKeys.has(`${playerLinkSource.table}:${row.sourceKey}`)) continue
      const accountId = text(row.rawRow, 'user_id')
      const steamId = text(row.rawRow, 'steam_id')
      const linkedVia = text(row.rawRow, 'linked_via')
      const linkedAt = legacyTimestamp(row.rawRow.linked_at)
      const classification = classifyLegacyPlayerLink(text(row.rawRow, 'status'), row.rawRow.brawlhalla_id)
      const [account] = accountId
        ? await sql.unsafe<{ exists: boolean }[]>(
            'SELECT EXISTS (SELECT 1 FROM accounts.users WHERE id = $1::uuid) AS exists',
            [accountId],
          )
        : [{ exists: false }]
      if (!accountId || !steamId || linkedVia !== 'steam' || linkedAt === null || !classification || !account.exists) {
        addExpected(playerLinkSource.table, row, 'invalid-player-link', {
          reason: 'unsupported-or-malformed-link',
        })
      }
    }
  }

  const actual = await sql<
    Array<{
      source_table: string
      source_key: string
      code: string
      evidence: Record<string, unknown>
      archive_content_checksum: string
    }>
  >`
    SELECT source_table, source_key, code, evidence, archive_content_checksum
    FROM accounts.legacy_import_rejections
    ORDER BY source_table, source_key, code
  `
  if (actual.length !== expected.size) return false
  const seen = new Set<string>()
  for (const rejection of actual) {
    const key = `${rejection.source_table}:${rejection.source_key}`
    if (seen.has(key)) return false
    seen.add(key)
    const value = stableJson({
      code: rejection.code,
      evidence: rejection.evidence,
      archiveContentChecksum: rejection.archive_content_checksum.trim(),
    })
    if (expected.get(key) !== value) return false
  }
  return true
}

async function reconcile(sql: Sql, manifest: SourceManifest, cutoff: Date): Promise<Reconciliation> {
  const [counts] = await sql<
    Array<{
      archived: number
      transformed: number
      rejected: number
      users: number
      identities: number
      valid_sessions: number
      transformed_attempts: number
      actual_attempts: number
      primaries: number
      user_mismatches: number
      identity_mismatches: number
      session_mismatches: number
      expected_sessions: number
      expected_primaries: number
      checksum_mismatches: number
      cutover_rows: number
      imported_v2_sessions: number
      rejection_mismatches: number
      required_trigger_mismatches: number
    }>
  >`
    SELECT
      (SELECT count(*)::integer FROM accounts.legacy_archive) AS archived,
      (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE outcome = 'transformed') AS transformed,
      (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE outcome = 'rejected') AS rejected,
      (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE destination_kind = 'user') AS users,
      (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE destination_kind = 'oauth-identity') AS identities,
      (SELECT count(*)::integer FROM public.session source
       JOIN accounts.sessions destination ON destination.id = source.id
       WHERE source.expires_at AT TIME ZONE 'UTC' > ${cutoff}
         AND EXISTS (SELECT 1 FROM public.oauth_account identity WHERE identity.user_id = source.user_id)
         AND destination.account_id = source.user_id
         AND destination.expires_at = source.expires_at AT TIME ZONE 'UTC'
         AND destination.created_at = source.created_at AT TIME ZONE 'UTC') AS valid_sessions,
      (SELECT count(*)::integer FROM accounts.legacy_import_ledger
       WHERE destination_kind = 'verification-attempt') AS transformed_attempts,
      (SELECT count(*)::integer FROM accounts.primary_player_verification_attempts
       WHERE idempotency_key LIKE 'legacy:%') AS actual_attempts,
      (SELECT count(*)::integer FROM accounts.primary_players primary_player
       JOIN accounts.primary_player_verification_attempts attempt
         ON attempt.id = primary_player.verification_attempt_id
       WHERE attempt.idempotency_key LIKE 'legacy:%') AS primaries,
      (SELECT count(*)::integer FROM public."user" source
       LEFT JOIN accounts.users destination ON destination.id = source.id
       WHERE destination.id IS NULL
          OR destination.created_at <> source.created_at AT TIME ZONE 'UTC'
          OR destination.updated_at <> source.updated_at AT TIME ZONE 'UTC') AS user_mismatches,
      (SELECT count(*)::integer FROM public.oauth_account source
       LEFT JOIN accounts.oauth_identities destination
         ON destination.provider = source.provider AND destination.provider_account_id = source.provider_account_id
       WHERE destination.provider IS NULL OR destination.account_id <> source.user_id
          OR destination.display_name <> source.username
          OR destination.avatar_hash IS DISTINCT FROM source.avatar_hash
          OR destination.refresh_token IS DISTINCT FROM source.refresh_token
          OR destination.created_at <> source.created_at AT TIME ZONE 'UTC'
          OR destination.updated_at <> source.updated_at AT TIME ZONE 'UTC') AS identity_mismatches,
      (SELECT count(*)::integer FROM public.session source
       WHERE source.expires_at AT TIME ZONE 'UTC' > ${cutoff}
         AND EXISTS (SELECT 1 FROM public.oauth_account identity WHERE identity.user_id = source.user_id)
         AND NOT EXISTS (
           SELECT 1 FROM accounts.sessions destination
           WHERE destination.id = source.id AND destination.account_id = source.user_id
             AND destination.expires_at = source.expires_at AT TIME ZONE 'UTC'
             AND destination.created_at = source.created_at AT TIME ZONE 'UTC'
         )) AS session_mismatches,
      (SELECT count(*)::integer FROM public.session source
       WHERE source.expires_at AT TIME ZONE 'UTC' > ${cutoff}
         AND EXISTS (SELECT 1 FROM public.oauth_account identity WHERE identity.user_id = source.user_id)) AS expected_sessions,
      (SELECT count(*)::integer FROM public.player_link source
       WHERE source.status = 'linked' AND source.brawlhalla_id BETWEEN 1 AND 2147483647
         AND (SELECT count(*) FROM public.player_link duplicate
              WHERE duplicate.status = 'linked' AND duplicate.brawlhalla_id = source.brawlhalla_id) = 1) AS expected_primaries,
      ((SELECT count(*) FROM accounts.legacy_import_ledger ledger
        JOIN accounts.legacy_archive archive USING (source_table, source_key)
        WHERE ledger.archive_content_checksum <> archive.content_checksum)
       +
       (SELECT count(*) FROM accounts.legacy_import_rejections rejection
        JOIN accounts.legacy_archive archive USING (source_table, source_key)
        WHERE rejection.archive_content_checksum <> archive.content_checksum))::integer AS checksum_mismatches,
      (SELECT count(*)::integer FROM accounts.v2_auth_cutover WHERE singleton) AS cutover_rows,
      (SELECT count(*)::integer FROM accounts.sessions WHERE imported_from_v2) AS imported_v2_sessions,
      ((SELECT count(*) FROM accounts.legacy_import_ledger ledger
        WHERE ledger.outcome = 'rejected'
          AND (SELECT count(*) FROM accounts.legacy_import_rejections rejection
               WHERE rejection.source_table = ledger.source_table
                 AND rejection.source_key = ledger.source_key
                 AND rejection.archive_content_checksum = ledger.archive_content_checksum) <> 1)
       +
       (SELECT count(*) FROM accounts.legacy_import_rejections rejection
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts.legacy_import_ledger ledger
          WHERE ledger.source_table = rejection.source_table
            AND ledger.source_key = rejection.source_key
            AND ledger.outcome = 'rejected'
            AND ledger.archive_content_checksum = rejection.archive_content_checksum
        )))::integer AS rejection_mismatches,
      (SELECT count(*)::integer
       FROM (VALUES
         ('accounts.legacy_archive'::regclass, 'accounts_legacy_archive_immutable',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_archive'::regclass, 'accounts_legacy_archive_prevent_truncate',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_ledger'::regclass, 'accounts_legacy_import_ledger_immutable',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_ledger'::regclass, 'accounts_legacy_import_ledger_prevent_truncate',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_rejections'::regclass, 'accounts_legacy_import_rejections_immutable',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_rejections'::regclass, 'accounts_legacy_import_rejections_prevent_truncate',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_audit_events'::regclass, 'accounts_legacy_import_audit_immutable',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.legacy_import_audit_events'::regclass, 'accounts_legacy_import_audit_prevent_truncate',
          'accounts.reject_legacy_import_evidence_change()'::regprocedure, 'Accounts legacy migration evidence is immutable'),
         ('accounts.primary_player_verification_attempts'::regclass, 'primary_player_attempts_immutable',
          'accounts.reject_primary_player_history_mutation()'::regprocedure, 'Primary Player verification history is immutable'),
         ('accounts.primary_player_verification_attempts'::regclass, 'accounts_primary_attempts_prevent_truncate',
          'accounts.reject_primary_player_history_mutation()'::regprocedure, 'Primary Player verification history is immutable'),
         ('accounts.primary_player_verification_outcomes'::regclass, 'primary_player_outcomes_immutable',
          'accounts.reject_primary_player_history_mutation()'::regprocedure, 'Primary Player verification history is immutable'),
         ('accounts.primary_player_verification_outcomes'::regclass, 'accounts_primary_outcomes_prevent_truncate',
          'accounts.reject_primary_player_history_mutation()'::regprocedure, 'Primary Player verification history is immutable')
       ) AS required(relation_id, trigger_name, function_id, error_text)
       LEFT JOIN pg_trigger trigger
         ON trigger.tgrelid = required.relation_id
        AND trigger.tgname = required.trigger_name
        AND trigger.tgfoid = required.function_id
        AND trigger.tgtype = CASE WHEN required.trigger_name LIKE '%prevent_truncate' THEN 34 ELSE 27 END
        AND NOT trigger.tgisinternal
        AND trigger.tgenabled = 'O'
       LEFT JOIN pg_proc trigger_function ON trigger_function.oid = trigger.tgfoid
       WHERE trigger.oid IS NULL
          OR btrim(trigger_function.prosrc, E' \n\r\t') IS DISTINCT FROM
             CASE
               WHEN required.function_id = 'accounts.reject_legacy_import_evidence_change()'::regprocedure
                 THEN format(E'BEGIN\n  RAISE EXCEPTION %L;\nEND;', required.error_text)
               ELSE format(E'BEGIN\n  RAISE EXCEPTION %L;\nEND', required.error_text)
             END) AS required_trigger_mismatches
  `
  const archiveState = await readArchiveState(sql)
  const sourceArchiveMatches = await sourceArchiveExact(sql)
  const playerLinks = await reconcilePlayerLinks(sql)
  const rejectionsMatch = await rejectionEvidenceExact(sql, cutoff)
  const ledgerRows = counts.transformed + counts.rejected
  const semanticExact =
    counts.user_mismatches === 0 &&
    counts.identity_mismatches === 0 &&
    counts.session_mismatches === 0 &&
    counts.valid_sessions === counts.expected_sessions &&
    counts.transformed_attempts === playerLinks.expectedAttempts &&
    counts.actual_attempts === playerLinks.expectedAttempts &&
    playerLinks.mismatches === 0 &&
    counts.primaries === counts.expected_primaries &&
    counts.checksum_mismatches === 0 &&
    counts.cutover_rows === 1 &&
    counts.imported_v2_sessions === 0 &&
    counts.rejection_mismatches === 0 &&
    counts.required_trigger_mismatches === 0 &&
    rejectionsMatch &&
    archiveState.mismatches === 0 &&
    sourceArchiveMatches &&
    archiveState.checksum === manifest.archiveChecksum
  const exact = counts.archived === manifest.sourceRows && ledgerRows === manifest.sourceRows && semanticExact
  return {
    sourceRows: manifest.sourceRows,
    archivedRows: counts.archived,
    transformedRows: counts.transformed,
    rejectedRows: counts.rejected,
    preservedUsers: counts.users,
    preservedOAuthIdentities: counts.identities,
    preservedValidSessions: counts.valid_sessions,
    preservedAttempts: counts.actual_attempts,
    primaryPlayers: counts.primaries,
    sourceChecksum: manifest.sourceChecksum,
    archiveChecksum: archiveState.checksum,
    semanticExact,
    exact,
  }
}

function checkpoint(progress: ProgressRow): LegacyAccountsImportResult['checkpoint'] {
  return progress.status === 'complete' ? null : { stage: progress.stage, sourceKey: progress.last_source_key }
}

function normalizeReconciliation(value: StoredReconciliation): Reconciliation {
  const { auditEventCount: _auditEventCount, auditChecksum: _auditChecksum, ...reconciliation } = value
  return {
    ...reconciliation,
    sourceChecksum: reconciliation.sourceChecksum.trim(),
    archiveChecksum: reconciliation.archiveChecksum.trim(),
  }
}

function reconciliationsMatch(left: Reconciliation, right: Reconciliation): boolean {
  return stableJson(normalizeReconciliation(left)) === stableJson(normalizeReconciliation(right))
}

async function completedAuditExact(sql: Sql, sourceChecksum: string): Promise<boolean> {
  const [state] = await sql<Array<{ completed: number; mismatches: number }>>`
    SELECT
      count(*) FILTER (WHERE event = 'completed')::integer AS completed,
      count(*) FILTER (
        WHERE event = 'completed'
          AND (
            evidence->>'exact' IS DISTINCT FROM 'true'
            OR (
              evidence->>'sourceChecksum' IS DISTINCT FROM ${sourceChecksum}
              AND NOT (evidence->>'replayed' = 'true' AND NOT evidence ? 'sourceChecksum')
            )
            OR NOT EXISTS (
              SELECT 1 FROM accounts.legacy_import_audit_events started
              WHERE started.run_id = accounts.legacy_import_audit_events.run_id
                AND started.event = 'started'
            )
          )
      )::integer AS mismatches
    FROM accounts.legacy_import_audit_events
  `
  return state.completed > 0 && state.mismatches === 0
}

async function versionedCompletionEvents(sql: Sql): Promise<number> {
  const [state] = await sql<Array<{ count: number }>>`
    SELECT count(*)::integer AS count
    FROM accounts.legacy_import_audit_events
    WHERE event = 'completed' AND evidence->>'attestationVersion' = ${String(AUDIT_ATTESTATION_VERSION)}
  `
  return state.count
}

async function readTerminalAuditState(sql: Sql): Promise<{ auditEventCount: number; auditChecksum: string }> {
  const rows = await sql<
    Array<{ id: string; run_id: string; event: string; evidence: Record<string, unknown>; recorded_at: Date }>
  >`
    SELECT id::text, run_id::text, event, evidence, recorded_at
    FROM accounts.legacy_import_audit_events audit
    WHERE EXISTS (
      SELECT 1 FROM accounts.legacy_import_audit_events terminal
      WHERE terminal.run_id = audit.run_id AND terminal.event IN ('completed', 'blocked')
    )
    ORDER BY id
  `
  return { auditEventCount: rows.length, auditChecksum: checksum(stableJson(rows)) }
}

async function readProgress(sql: Sql): Promise<ProgressRow | null> {
  const [progress] = await sql<ProgressRow[]>`
    SELECT status, stage, last_source_key, source_manifest, source_checksum,
           session_cutoff_at, block_reason, reconciliation
    FROM accounts.legacy_import_progress WHERE singleton
  `
  return progress ?? null
}

async function blockImportTransaction(
  sql: Sql,
  runId: string,
  progress: ProgressRow,
  reason: Record<string, unknown>,
): Promise<LegacyAccountsImportResult> {
  const current = await reconcile(sql, progress.source_manifest, progress.session_cutoff_at)
  const reconciliation = { ...current, semanticExact: false, exact: false }
  await sql`
    UPDATE accounts.legacy_import_progress
    SET status = 'blocked', block_reason = ${sql.json(jsonValue(reason))}, reconciliation = ${sql.json(jsonValue(reconciliation))},
        completed_at = NULL, updated_at = clock_timestamp()
    WHERE singleton
  `
  await sql`
    INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
    VALUES (${runId}, 'blocked', ${sql.json(jsonValue({ code: typeof reason.code === 'string' ? reason.code : 'blocked' }))})
  `
  return { status: 'blocked', checkpoint: checkpoint({ ...progress, status: 'blocked' }), reconciliation }
}

async function blockImport(
  client: Sql,
  runId: string,
  progress: ProgressRow,
  reason: Record<string, unknown>,
): Promise<LegacyAccountsImportResult> {
  return client.begin(async (transaction) =>
    blockImportTransaction(transaction as unknown as Sql, runId, progress, reason),
  )
}

export async function importLegacyAccounts(
  connectionString: string,
  options: LegacyAccountsImportOptions,
): Promise<LegacyAccountsImportResult> {
  const { batchSize, maxBatches } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  const runId = crypto.randomUUID()
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client.unsafe("SET lock_timeout = '30s'")
    await client.unsafe('SET statement_timeout = 30000')
    await client`SELECT pg_advisory_lock(hashtextextended(${ACCOUNTS_WRITER_MAINTENANCE_FENCE}, 0))`
    locked = true
    await client.unsafe('SET statement_timeout = 0')
    await client`
      INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
      VALUES (${runId}, 'started', ${client.json(jsonValue({ manifestVersion: MANIFEST_VERSION }))})
    `

    const manifest = await client.begin(async (transaction) => {
      const sql = transaction as unknown as Sql
      await lockSources(sql)
      return computeSourceManifest(sql)
    })
    let progress = await readProgress(client)
    if (!progress) {
      const [created] = await client<ProgressRow[]>`
        INSERT INTO accounts.legacy_import_progress (
          status, stage, source_manifest, source_checksum, session_cutoff_at
        ) VALUES ('in-progress', 'users', ${client.json(jsonValue(manifest))}, ${manifest.sourceChecksum}, clock_timestamp())
        RETURNING status, stage, last_source_key, source_manifest, source_checksum,
                  session_cutoff_at, block_reason, reconciliation
      `
      progress = created
    }
    if (!progress) throw new Error('Failed to initialize Accounts import progress')
    if (progress.status === 'blocked') {
      const stored = progress.reconciliation
      if (!stored) throw new Error('Blocked Accounts import is missing reconciliation')
      await client`
        INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
        VALUES (${runId}, 'blocked', ${client.json(jsonValue({ code: 'already-blocked' }))})
      `
      return { status: 'blocked', checkpoint: checkpoint(progress), reconciliation: normalizeReconciliation(stored) }
    }
    if (!manifestsMatch(progress.source_manifest, manifest)) {
      return await blockImport(client, runId, progress, {
        code: 'source-manifest-changed',
        frozenChecksum: progress.source_checksum.trim(),
        currentChecksum: manifest.sourceChecksum,
      })
    }
    if (progress.status === 'complete') {
      const stored = progress.reconciliation
      if (!stored) throw new Error('Completed Accounts import is missing reconciliation')
      const replayed = await reconcile(client, progress.source_manifest, progress.session_cutoff_at)
      const auditExact = await completedAuditExact(client, progress.source_checksum.trim())
      const previousAudit = await readTerminalAuditState(client)
      const versionedCompletions = await versionedCompletionEvents(client)
      const storedAuditExact =
        stored.auditEventCount === undefined && stored.auditChecksum === undefined
          ? versionedCompletions === 0
          : stored.auditEventCount === previousAudit.auditEventCount &&
            stored.auditChecksum === previousAudit.auditChecksum
      if (
        !stored.exact ||
        !stored.semanticExact ||
        !replayed.exact ||
        !reconciliationsMatch(stored, replayed) ||
        !auditExact ||
        !storedAuditExact
      ) {
        return await blockImport(client, runId, progress, { code: 'completed-evidence-drift' })
      }
      return client.begin(async (transaction): Promise<LegacyAccountsImportResult> => {
        const sql = transaction as unknown as Sql
        await sql`
          INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
          VALUES (${runId}, 'completed', ${sql.json(
            jsonValue({
              exact: true,
              replayed: true,
              sourceChecksum: replayed.sourceChecksum,
              attestationVersion: AUDIT_ATTESTATION_VERSION,
            }),
          )})
        `
        const audit = await readTerminalAuditState(sql)
        await sql`
          UPDATE accounts.legacy_import_progress
          SET reconciliation = ${sql.json(jsonValue({ ...replayed, ...audit }))}, updated_at = clock_timestamp()
          WHERE singleton
        `
        return { status: 'complete', checkpoint: null, reconciliation: replayed }
      })
    }

    let activeProgress: ProgressRow = progress
    let batches = 0
    while (activeProgress.stage !== 'finalize' && batches < maxBatches) {
      const currentProgress: ProgressRow = activeProgress
      const source = SOURCES.find(({ stage }) => stage === currentProgress.stage)
      if (!source) throw new Error(`Unknown Accounts import stage ${currentProgress.stage}`)
      const batchResult: BatchResult = await client.begin(async (transaction): Promise<BatchResult> => {
        const sql = transaction as unknown as Sql
        await lockSources(sql)
        const currentManifest = await computeSourceManifest(sql)
        if (!manifestsMatch(currentProgress.source_manifest, currentManifest)) {
          return { kind: 'source-changed', manifest: currentManifest }
        }
        const rows: SourceDatabaseRow[] = await sql.unsafe<SourceDatabaseRow[]>(
          `${sourceRowsSql(source, `WHERE ($1::text IS NULL OR ${source.keyExpression} > $1)`, 'source_key')} LIMIT $2`,
          [currentProgress.last_source_key, batchSize],
        )
        if (rows.length === 0) {
          const sourceIndex = SOURCES.indexOf(source)
          const nextStage = SOURCES[sourceIndex + 1]?.stage ?? 'finalize'
          const [advanced] = await sql<ProgressRow[]>`
            UPDATE accounts.legacy_import_progress
            SET stage = ${nextStage}, last_source_key = NULL, updated_at = clock_timestamp()
            WHERE singleton
            RETURNING status, stage, last_source_key, source_manifest, source_checksum,
                      session_cutoff_at, block_reason, reconciliation
          `
          return { kind: 'advanced', progress: advanced }
        }
        let lastSourceKey: string | null = null
        for (const databaseRow of rows) {
          const row = normalizeSourceRow(source.table, databaseRow)
          await archiveRow(sql, source, row)
          const blockingReason = await transformRow(sql, source, row, currentProgress.session_cutoff_at)
          lastSourceKey = row.sourceKey
          if (blockingReason) {
            const [blockedProgress] = await sql<ProgressRow[]>`
              UPDATE accounts.legacy_import_progress
              SET last_source_key = ${lastSourceKey}, updated_at = clock_timestamp()
              WHERE singleton
              RETURNING status, stage, last_source_key, source_manifest, source_checksum,
                        session_cutoff_at, block_reason, reconciliation
            `
            if (!blockedProgress) throw new Error('Accounts import progress disappeared')
            return {
              kind: 'blocked',
              result: await blockImportTransaction(sql, runId, blockedProgress, blockingReason),
            }
          }
        }
        const [updated] = await sql<ProgressRow[]>`
          UPDATE accounts.legacy_import_progress
          SET last_source_key = ${lastSourceKey}, updated_at = clock_timestamp()
          WHERE singleton
          RETURNING status, stage, last_source_key, source_manifest, source_checksum,
                    session_cutoff_at, block_reason, reconciliation
        `
        return { kind: 'batch', progress: updated }
      })
      if (batchResult.kind === 'source-changed') {
        return await blockImport(client, runId, activeProgress, {
          code: 'source-manifest-changed',
          frozenChecksum: activeProgress.source_checksum.trim(),
          currentChecksum: batchResult.manifest.sourceChecksum,
        })
      }
      if (batchResult.kind === 'blocked') return batchResult.result
      if (!batchResult.progress) throw new Error('Accounts import progress disappeared')
      activeProgress = batchResult.progress
      if (batchResult.kind === 'batch') batches += 1
    }

    if (activeProgress.stage !== 'finalize') {
      const reconciliation = await reconcile(client, activeProgress.source_manifest, activeProgress.session_cutoff_at)
      return {
        status: 'in-progress',
        checkpoint: checkpoint(activeProgress),
        reconciliation: { ...reconciliation, exact: false },
      }
    }

    try {
      return await client.begin(async (transaction): Promise<LegacyAccountsImportResult> => {
        const sql = transaction as unknown as Sql
        await lockSources(sql)
        const finalManifest = await computeSourceManifest(sql)
        if (!manifestsMatch(activeProgress.source_manifest, finalManifest)) {
          throw new FinalizationBlockedError({
            code: 'source-manifest-changed',
            frozenChecksum: activeProgress.source_checksum.trim(),
            currentChecksum: finalManifest.sourceChecksum,
          })
        }
        const [clock] = await sql<{ cutoff: Date }[]>`SELECT CURRENT_TIMESTAMP AS cutoff`
        await finalizeV2AuthCutoverTransaction(transaction)
        const reconciliation = await reconcile(sql, activeProgress.source_manifest, clock.cutoff)
        if (!reconciliation.exact) {
          throw new FinalizationBlockedError({ code: 'reconciliation-failed' })
        }
        await sql`
          INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
          VALUES (${runId}, 'completed', ${sql.json(
            jsonValue({
              exact: true,
              sourceChecksum: reconciliation.sourceChecksum,
              attestationVersion: AUDIT_ATTESTATION_VERSION,
            }),
          )})
        `
        const audit = await readTerminalAuditState(sql)
        await sql`
          UPDATE accounts.legacy_import_progress
          SET status = 'complete', session_cutoff_at = ${clock.cutoff},
              reconciliation = ${sql.json(jsonValue({ ...reconciliation, ...audit }))},
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE singleton
        `
        return { status: 'complete', checkpoint: null, reconciliation }
      })
    } catch (error) {
      if (error instanceof FinalizationBlockedError) {
        return await blockImport(client, runId, activeProgress, error.reason)
      }
      throw error
    }
  } finally {
    if (locked) {
      await client`SELECT pg_advisory_unlock(hashtextextended(${ACCOUNTS_WRITER_MAINTENANCE_FENCE}, 0))`
    }
    await client.end()
  }
}
