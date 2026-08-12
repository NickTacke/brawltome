import { createHash } from 'node:crypto'
import postgres from 'postgres'

const IMPORT_LOCK_KEY = 222_197_201
const DEFAULT_BATCH_SIZE = 10_000
const EMPTY_CHECKSUM = createHash('sha256').update('').digest('hex')
const PROFILE_ROW_SQL = `SELECT source.brawlhalla_id, source.name, source.rating, source.best_legend, source.last_updated,
  source.brawlhalla_id::text AS source_key,
  jsonb_build_object(
    'brawlhalla_id', source.brawlhalla_id,
    'name', source.name,
    'rating', source.rating,
    'best_legend', source.best_legend,
    'last_updated', source.last_updated
  )::text AS raw_json
  FROM public.player source`

type Sql = ReturnType<typeof postgres>
type SourceDatabaseRow = {
  brawlhalla_id: number
  name: unknown
  rating: unknown
  best_legend: unknown
  last_updated: unknown
  source_key: string
  raw_json: string
}
type SourceManifest = { sourceRows: number; sourceChecksum: string }
type ProgressRow = {
  status: LegacyPlayerProfileImportResult['status']
  last_player_id: number | null
  source_rows: number
  source_checksum: string
}
type Reconciliation = {
  sourceRows: number
  archivedRows: number
  transformedRows: number
  rejectedRows: number
  sourceChecksum: string
  archiveChecksum: string
  semanticExact: boolean
  exact: boolean
}

export type LegacyPlayerProfileImportOptions = {
  batchSize?: number
  maxBatches?: number
  legacyWritersQuiesced?: true
}
export type LegacyPlayerProfileImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: { stage: 'profiles'; sourceKey: string } | null
  reconciliation: Reconciliation
}

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function addChecksumFrame(hash: ReturnType<typeof createHash>, sourceKey: string, rowChecksum: string): void {
  for (const value of ['player', sourceKey, rowChecksum]) {
    const frame = Buffer.from(value, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(frame.length)
    hash.update(length).update(frame)
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function visibleText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && [...value].length <= maximum && /[^\p{Separator}\p{Format}]/u.test(value)
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const text = value instanceof Date ? value.toISOString() : value
  const explicit = /(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const parsed = new Date(explicit)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function validateOptions(options: LegacyPlayerProfileImportOptions): {
  batchSize: number
  maxBatches: number
  legacyWritersQuiesced: boolean
} {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Player profile import batchSize must be between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Player profile import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches, legacyWritersQuiesced: options.legacyWritersQuiesced === true }
}

async function computeSourceManifest(sql: Sql): Promise<SourceManifest> {
  const hash = createHash('sha256')
  let sourceRows = 0
  for await (const rows of sql
    .unsafe<SourceDatabaseRow[]>(`${PROFILE_ROW_SQL} ORDER BY source.brawlhalla_id`)
    .cursor(1_000)) {
    for (const row of rows) {
      addChecksumFrame(hash, row.source_key, checksum(row.raw_json))
      sourceRows += 1
    }
  }
  return { sourceRows, sourceChecksum: hash.digest('hex') }
}

async function lockSourceAndReadManifest(sql: Sql): Promise<SourceManifest> {
  await sql.unsafe('LOCK TABLE public.player IN SHARE MODE')
  return computeSourceManifest(sql)
}

async function evidenceIsImmutable(sql: Sql): Promise<boolean> {
  const [session] = await sql<{ replication_role: string }[]>`
    SELECT current_setting('session_replication_role') AS replication_role
  `
  if (session.replication_role !== 'origin') return false
  await sql.unsafe(
    'LOCK TABLE players.legacy_profile_archive, players.legacy_profile_import_ledger, players.legacy_profile_import_rejections, players.legacy_profile_discovery IN SHARE ROW EXCLUSIVE MODE',
  )
  const required = new Set([
    'legacy_profile_archive:players_legacy_profile_archive_immutable:prevent_legacy_archive_mutation',
    'legacy_profile_archive:players_legacy_profile_archive_prevent_truncate:prevent_legacy_archive_mutation',
    'legacy_profile_import_ledger:players_legacy_profile_ledger_immutable:prevent_legacy_archive_mutation',
    'legacy_profile_import_ledger:players_legacy_profile_ledger_prevent_truncate:prevent_legacy_archive_mutation',
    'legacy_profile_import_rejections:players_legacy_profile_rejections_immutable:prevent_legacy_archive_mutation',
    'legacy_profile_import_rejections:players_legacy_profile_rejections_prevent_truncate:prevent_legacy_archive_mutation',
    'legacy_profile_discovery:players_legacy_profile_discovery_immutable:prevent_legacy_archive_mutation',
    'legacy_profile_discovery:players_legacy_profile_discovery_prevent_truncate:prevent_legacy_archive_mutation',
  ])
  const rows = await sql<Array<{ relation: string; trigger: string; function_name: string }>>`
    SELECT relation.relname AS relation, trigger.tgname AS trigger, function.proname AS function_name
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace relation_schema ON relation_schema.oid = relation.relnamespace
    JOIN pg_proc function ON function.oid = trigger.tgfoid
    JOIN pg_namespace function_schema ON function_schema.oid = function.pronamespace
    WHERE relation_schema.nspname = 'players'
      AND function_schema.nspname = 'players'
      AND trigger.tgenabled IN ('O', 'A')
      AND NOT trigger.tgisinternal
  `
  const actual = new Set(rows.map(({ relation, trigger, function_name }) => `${relation}:${trigger}:${function_name}`))
  return [...required].every((trigger) => actual.has(trigger))
}

async function sourceArchiveExact(sql: Sql): Promise<boolean> {
  const [comparison] = await sql.unsafe<Array<{ exact: boolean }>>(`
    SELECT NOT EXISTS (
      SELECT 1
      FROM (${PROFILE_ROW_SQL}) source
      FULL JOIN players.legacy_profile_archive archive USING (brawlhalla_id)
      WHERE source.brawlhalla_id IS NULL
         OR archive.brawlhalla_id IS NULL
         OR source.raw_json::jsonb IS DISTINCT FROM archive.raw_row
         OR archive.row_checksum <> encode(sha256(convert_to(source.raw_json, 'UTF8')), 'hex')
    ) AS exact
  `)
  return comparison?.exact ?? false
}

async function reconcile(sql: Sql, manifest: SourceManifest): Promise<Reconciliation> {
  const hash = createHash('sha256')
  let archivedRows = 0
  for await (const rows of sql<
    Array<{ brawlhalla_id: number; row_checksum: string }>
  >`SELECT brawlhalla_id, row_checksum FROM players.legacy_profile_archive ORDER BY brawlhalla_id`.cursor(1_000)) {
    for (const row of rows) {
      addChecksumFrame(hash, String(row.brawlhalla_id), row.row_checksum.trim())
      archivedRows += 1
    }
  }
  const archiveChecksum = archivedRows === 0 ? EMPTY_CHECKSUM : hash.digest('hex')
  const [counts] = await sql<Array<{ transformed: number; rejected: number; semantic_exact: boolean }>>`
    SELECT
      (SELECT count(*)::integer FROM players.legacy_profile_import_ledger WHERE outcome = 'transformed') AS transformed,
      (SELECT count(*)::integer FROM players.legacy_profile_import_ledger WHERE outcome = 'rejected') AS rejected,
      NOT EXISTS (
        SELECT 1
        FROM players.legacy_profile_archive archive
        LEFT JOIN players.legacy_profile_import_ledger ledger USING (brawlhalla_id)
        LEFT JOIN players.legacy_profile_discovery profile USING (brawlhalla_id)
        LEFT JOIN players.legacy_profile_import_rejections rejection USING (brawlhalla_id)
        WHERE archive.row_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
           OR ledger.archive_checksum <> archive.row_checksum
           OR (ledger.outcome = 'transformed' AND (
             profile.brawlhalla_id IS NULL
             OR rejection.brawlhalla_id IS NOT NULL
             OR profile.player_name IS DISTINCT FROM archive.raw_row->>'name'
             OR profile.rating IS DISTINCT FROM CASE WHEN (archive.raw_row->>'rating')::bigint > 0
               THEN (archive.raw_row->>'rating')::integer ELSE NULL END
             OR profile.best_legend IS DISTINCT FROM CASE WHEN (archive.raw_row->>'best_legend')::bigint > 0
               THEN (archive.raw_row->>'best_legend')::integer ELSE NULL END
             OR profile.observed_at <> ((archive.raw_row->>'last_updated')::timestamp AT TIME ZONE 'UTC')
             OR profile.archive_checksum <> archive.row_checksum
           ))
           OR (ledger.outcome = 'rejected' AND (
             rejection.brawlhalla_id IS NULL
             OR profile.brawlhalla_id IS NOT NULL
             OR rejection.archive_checksum <> archive.row_checksum
           ))
      ) AS semantic_exact
  `
  const semanticExact = (await sourceArchiveExact(sql)) && counts.semantic_exact
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
    sourceChecksum: manifest.sourceChecksum,
    archiveChecksum,
    semanticExact,
    exact,
  }
}

async function block(sql: Sql, reason: Record<string, unknown>): Promise<void> {
  await sql`
    UPDATE players.legacy_profile_import_progress
    SET status = 'blocked', completed_at = NULL,
        block_reason = ${sql.json(JSON.parse(JSON.stringify(reason)))}, updated_at = clock_timestamp()
    WHERE singleton
  `
}

export async function importLegacyPlayerProfiles(
  connectionString: string,
  options: LegacyPlayerProfileImportOptions = {},
): Promise<LegacyPlayerProfileImportResult> {
  const { batchSize, maxBatches, legacyWritersQuiesced } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    const manifest = await client.begin(async (transaction) => lockSourceAndReadManifest(transaction as unknown as Sql))
    let [progress] = await client<ProgressRow[]>`
      SELECT status, last_player_id, source_rows, source_checksum
      FROM players.legacy_profile_import_progress WHERE singleton
    `
    if (!progress) {
      ;[progress] = await client<ProgressRow[]>`
        INSERT INTO players.legacy_profile_import_progress (status, source_rows, source_checksum)
        VALUES ('in-progress', ${manifest.sourceRows}, ${manifest.sourceChecksum})
        RETURNING status, last_player_id, source_rows, source_checksum
      `
    } else if (
      progress.source_rows !== manifest.sourceRows ||
      progress.source_checksum.trim() !== manifest.sourceChecksum
    ) {
      await block(client, { code: 'source-manifest-changed', frozen: progress, current: manifest })
      return {
        status: 'blocked',
        checkpoint:
          progress.last_player_id === null ? null : { stage: 'profiles', sourceKey: String(progress.last_player_id) },
        reconciliation: await reconcile(client, manifest),
      }
    }

    let cursor = progress.last_player_id
    let batches = 0
    let completed = progress.status === 'complete'
    while (!completed && batches < maxBatches) {
      const batch = await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        if (!(await evidenceIsImmutable(sql))) return { outcome: 'evidence-unavailable' as const }
        if (!legacyWritersQuiesced) {
          const current = await lockSourceAndReadManifest(sql)
          if (current.sourceRows !== manifest.sourceRows || current.sourceChecksum !== manifest.sourceChecksum) {
            return { outcome: 'source-changed' as const, current }
          }
        }
        const rows = await sql.unsafe<SourceDatabaseRow[]>(
          `${PROFILE_ROW_SQL} WHERE ($1::integer IS NULL OR source.brawlhalla_id > $1::integer)
           ORDER BY source.brawlhalla_id LIMIT $2`,
          [cursor, batchSize],
        )
        if (rows.length === 0) {
          await sql`
            UPDATE players.legacy_profile_import_progress
            SET status = 'complete', completed_at = clock_timestamp(), block_reason = NULL,
                updated_at = clock_timestamp()
            WHERE singleton
          `
          return { outcome: 'complete' as const }
        }
        const checksums = rows.map(({ raw_json }) => checksum(raw_json))
        await sql`
          INSERT INTO players.legacy_profile_archive (brawlhalla_id, raw_row, row_checksum)
          SELECT brawlhalla_id, raw_row::jsonb, row_checksum
          FROM unnest(
            ${rows.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[],
            ${rows.map(({ raw_json }) => raw_json)}::text[],
            ${checksums}::text[]
          ) AS archive(brawlhalla_id, raw_row, row_checksum)
          ON CONFLICT DO NOTHING
        `
        const validRows = rows.flatMap((row, index) => {
          const raw = JSON.parse(row.raw_json) as Record<string, unknown>
          const observedAt = raw.last_updated
          if (
            !positiveInteger(row.brawlhalla_id) ||
            !visibleText(row.name, 256) ||
            typeof observedAt !== 'string' ||
            !timestamp(observedAt)
          ) {
            return []
          }
          return [{ row, checksum: checksums[index], observedAt }]
        })
        const validIds = new Set(validRows.map(({ row }) => row.brawlhalla_id))
        if (validRows.length > 0) {
          await sql`
            INSERT INTO players.legacy_profile_discovery
              (brawlhalla_id, player_name, rating, best_legend, observed_at, archive_checksum)
            SELECT incoming.brawlhalla_id, incoming.player_name, incoming.rating, incoming.best_legend,
                   (archive.raw_row->>'last_updated')::timestamp AT TIME ZONE 'UTC', incoming.archive_checksum
            FROM unnest(
              ${validRows.map(({ row }) => row.brawlhalla_id)}::integer[],
              ${validRows.map(({ row }) => row.name as string)}::text[],
              ${validRows.map(({ row }) => (positiveInteger(row.rating) ? row.rating : null))}::integer[],
              ${validRows.map(({ row }) => (positiveInteger(row.best_legend) ? row.best_legend : null))}::integer[],
              ${validRows.map(({ checksum: value }) => value)}::text[]
            ) AS incoming(brawlhalla_id, player_name, rating, best_legend, archive_checksum)
            JOIN players.legacy_profile_archive archive USING (brawlhalla_id)
            ON CONFLICT DO NOTHING
          `
        }
        const rejected = rows.filter(({ brawlhalla_id }) => !validIds.has(brawlhalla_id))
        if (rejected.length > 0) {
          await sql`
            INSERT INTO players.legacy_profile_import_rejections
              (brawlhalla_id, code, evidence, archive_checksum)
            SELECT brawlhalla_id, code, evidence::jsonb, archive_checksum
            FROM unnest(
              ${rejected.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[],
              ${rejected.map(() => 'player-identity-invalid')}::text[],
              ${rejected.map(({ raw_json }) => raw_json)}::text[],
              ${rejected.map((row) => checksums[rows.indexOf(row)])}::text[]
            ) AS rejection(brawlhalla_id, code, evidence, archive_checksum)
            ON CONFLICT DO NOTHING
          `
        }
        await sql`
          INSERT INTO players.legacy_profile_import_ledger (brawlhalla_id, archive_checksum, outcome)
          SELECT * FROM unnest(
            ${rows.map(({ brawlhalla_id }) => brawlhalla_id)}::integer[],
            ${checksums}::text[],
            ${rows.map(({ brawlhalla_id }) => (validIds.has(brawlhalla_id) ? 'transformed' : 'rejected'))}::text[]
          ) AS ledger(brawlhalla_id, archive_checksum, outcome)
          ON CONFLICT DO NOTHING
        `
        const [state] = await sql<{ source_version: string }[]>`
          UPDATE players.discovery_state SET source_version = source_version + 1 WHERE singleton
          RETURNING source_version
        `
        await sql`
          INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
          SELECT identity, ${state.source_version}::bigint FROM unnest(${[...validIds]}::integer[]) identity
        `
        const nextCursor = rows.at(-1)?.brawlhalla_id ?? null
        await sql`
          UPDATE players.legacy_profile_import_progress
          SET status = 'in-progress', last_player_id = ${nextCursor}, block_reason = NULL,
              updated_at = clock_timestamp()
          WHERE singleton
        `
        return { outcome: 'archived' as const, cursor: nextCursor }
      })
      if (batch.outcome === 'evidence-unavailable') {
        await block(client, { code: 'evidence-immutability-unavailable' })
        return {
          status: 'blocked',
          checkpoint: cursor === null ? null : { stage: 'profiles', sourceKey: String(cursor) },
          reconciliation: await reconcile(client, manifest),
        }
      }
      if (batch.outcome === 'source-changed') {
        await block(client, { code: 'source-manifest-changed', frozen: manifest, current: batch.current })
        return {
          status: 'blocked',
          checkpoint: cursor === null ? null : { stage: 'profiles', sourceKey: String(cursor) },
          reconciliation: await reconcile(client, batch.current),
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
      await block(client, { code: 'reconciliation-failed', reconciliation })
      return {
        status: 'blocked',
        checkpoint: cursor === null ? null : { stage: 'profiles', sourceKey: String(cursor) },
        reconciliation,
      }
    }
    return {
      status: completed ? 'complete' : 'in-progress',
      checkpoint: completed || cursor === null ? null : { stage: 'profiles', sourceKey: String(cursor) },
      reconciliation,
    }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
