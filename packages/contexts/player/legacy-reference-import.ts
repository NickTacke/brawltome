import { createHash } from 'node:crypto'
import postgres from 'postgres'

const IMPORT_LOCK_KEY = 222_197_200
const DEFAULT_BATCH_SIZE = 1_000

type Sql = ReturnType<typeof postgres>
type SourceTable = 'player_alias' | 'rating_history'
type SourceRow = {
  source_key: string
  brawlhalla_id: number
  raw_json: string
}
type Reconciliation = {
  sourceRows: number
  archivedRows: number
  importedAliases: number
  importedHistory: number
  rejectedRows: number
  sourceExact: boolean
  destinationExact: boolean
  exact: boolean
}

export type LegacyReferenceImportResult = {
  status: 'complete' | 'in-progress' | 'blocked'
  checkpoint: { stage: SourceTable; sourceKey: string | null } | null
  reconciliation: Reconciliation
}

export type LegacyReferenceImportOptions = {
  batchSize?: number
  maxBatches?: number
  legacyWritersQuiesced?: true
}

function validateOptions(options: LegacyReferenceImportOptions): { batchSize: number; maxBatches: number } {
  if (options.legacyWritersQuiesced !== true) {
    throw new Error('Legacy reference import requires confirmed quiesced V2 Player writers')
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error('Legacy reference import batchSize must be an integer between 1 and 10000')
  }
  if (maxBatches !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxBatches) || maxBatches < 1)) {
    throw new Error('Legacy reference import maxBatches must be a positive integer')
  }
  return { batchSize, maxBatches }
}

function unwrapRawJson(rawJson: string): string {
  if (!rawJson.startsWith('"')) return rawJson
  try {
    const unwrapped: unknown = JSON.parse(rawJson)
    if (typeof unwrapped !== 'string') throw new Error('Legacy reference raw JSON wrapper must contain text')
    return unwrapped
  } catch (error) {
    throw new Error('Legacy reference raw JSON wrapper is invalid', { cause: error })
  }
}

function checksum(rawJson: string): string {
  return createHash('sha256').update(rawJson).digest('hex')
}

async function readBatch(sql: Sql, stage: SourceTable, limit: number): Promise<SourceRow[]> {
  const rows =
    stage === 'player_alias'
      ? await sql<SourceRow[]>`
          SELECT source.brawlhalla_id,
                 jsonb_build_array(source.brawlhalla_id, source.key)::text AS source_key,
                 to_jsonb(source)::text AS raw_json
          FROM public.player_alias source
          LEFT JOIN players.legacy_import_ledger ledger
            ON ledger.source_table = 'player_alias'
           AND ledger.source_key = jsonb_build_array(source.brawlhalla_id, source.key)::text
          WHERE ledger.source_key IS NULL
          ORDER BY source_key
          LIMIT ${limit}
        `
      : await sql<SourceRow[]>`
          SELECT source.brawlhalla_id, source.id::text AS source_key,
                 to_jsonb(source)::text AS raw_json
          FROM public.rating_history source
          LEFT JOIN players.legacy_import_ledger ledger
            ON ledger.source_table = 'rating_history' AND ledger.source_key = source.id::text
          WHERE ledger.source_key IS NULL
          ORDER BY source_key
          LIMIT ${limit}
        `
  return rows.map((row) => ({ ...row, raw_json: unwrapRawJson(row.raw_json) }))
}

async function archiveBatch(sql: Sql, stage: SourceTable, rows: SourceRow[]): Promise<void> {
  const sourceKeys = rows.map((row) => row.source_key)
  const playerIds = rows.map((row) => row.brawlhalla_id)
  const rawRows = rows.map((row) => row.raw_json)
  const checksums = rawRows.map(checksum)
  await sql`
    INSERT INTO players.legacy_archive
      (source_table, source_key, brawlhalla_id, raw_row, row_checksum, content_checksum)
    SELECT ${stage}, incoming.source_key, incoming.brawlhalla_id, incoming.raw_json::jsonb,
           incoming.row_checksum, encode(sha256(convert_to(incoming.raw_json::jsonb::text, 'UTF8')), 'hex')
    FROM unnest(${sourceKeys}::text[], ${playerIds}::integer[], ${rawRows}::text[], ${checksums}::text[])
      AS incoming(source_key, brawlhalla_id, raw_json, row_checksum)
    ON CONFLICT DO NOTHING
  `
  const [conflict] = await sql<{ source_key: string }[]>`
    SELECT incoming.source_key
    FROM unnest(${sourceKeys}::text[], ${rawRows}::text[], ${checksums}::text[])
      AS incoming(source_key, raw_json, row_checksum)
    LEFT JOIN players.legacy_archive archive
      ON archive.source_table = ${stage} AND archive.source_key = incoming.source_key
    WHERE archive.source_key IS NULL
       OR archive.row_checksum <> incoming.row_checksum
       OR archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
       OR archive.raw_row IS DISTINCT FROM incoming.raw_json::jsonb
    LIMIT 1
  `
  if (conflict) throw new Error(`Legacy reference source mutation detected for ${stage}/${conflict.source_key}`)
}

async function materializeAliases(sql: Sql, sourceKeys: string[]): Promise<void> {
  await sql`
    INSERT INTO players.legacy_discovery_aliases
      (brawlhalla_id, normalized_alias, display_alias, observed_at, archive_checksum)
    SELECT (archive.raw_row->>'brawlhalla_id')::integer,
           lower(archive.raw_row->>'value'), archive.raw_row->>'value',
           (archive.raw_row->>'created_at')::timestamp AT TIME ZONE 'UTC', archive.row_checksum
    FROM players.legacy_archive archive
    WHERE archive.source_table = 'player_alias' AND archive.source_key = ANY(${sourceKeys}::text[])
      AND (archive.raw_row->>'brawlhalla_id')::integer > 0
      AND length(archive.raw_row->>'value') <= 256
      AND archive.raw_row->>'value' ~ '[^[:space:]]'
    ON CONFLICT DO NOTHING
  `
  await sql`
    INSERT INTO players.legacy_import_rejections
      (source_table, source_key, code, evidence, archive_checksum)
    SELECT archive.source_table, archive.source_key,
           CASE WHEN (archive.raw_row->>'brawlhalla_id')::integer > 0
                       AND length(archive.raw_row->>'value') <= 256
                       AND archive.raw_row->>'value' ~ '[^[:space:]]'
                THEN 'alias-normalization-collision'
                ELSE 'alias-identity-invalid'
           END,
           archive.raw_row, archive.row_checksum
    FROM players.legacy_archive archive
    LEFT JOIN players.legacy_discovery_aliases destination
      ON destination.brawlhalla_id = (archive.raw_row->>'brawlhalla_id')::integer
     AND destination.normalized_alias = lower(archive.raw_row->>'value')
     AND destination.display_alias = archive.raw_row->>'value'
     AND destination.observed_at = ((archive.raw_row->>'created_at')::timestamp AT TIME ZONE 'UTC')
     AND destination.archive_checksum = archive.row_checksum
    WHERE archive.source_table = 'player_alias' AND archive.source_key = ANY(${sourceKeys}::text[])
      AND destination.brawlhalla_id IS NULL
    ON CONFLICT DO NOTHING
  `
  await sql`
    INSERT INTO players.legacy_import_ledger
      (source_table, source_key, archive_checksum, outcome)
    SELECT archive.source_table, archive.source_key, archive.row_checksum,
           CASE WHEN destination.brawlhalla_id IS NULL THEN 'rejected' ELSE 'transformed' END
    FROM players.legacy_archive archive
    LEFT JOIN players.legacy_discovery_aliases destination
      ON destination.brawlhalla_id = (archive.raw_row->>'brawlhalla_id')::integer
     AND destination.normalized_alias = lower(archive.raw_row->>'value')
     AND destination.display_alias = archive.raw_row->>'value'
     AND destination.observed_at = ((archive.raw_row->>'created_at')::timestamp AT TIME ZONE 'UTC')
     AND destination.archive_checksum = archive.row_checksum
    WHERE archive.source_table = 'player_alias' AND archive.source_key = ANY(${sourceKeys}::text[])
    ON CONFLICT DO NOTHING
  `
}

const validHistorySql = `(archive.raw_row->>'brawlhalla_id')::integer > 0
  AND (archive.raw_row->>'rating')::integer > 0
  AND (archive.raw_row->>'peak_rating')::integer >= 0
  AND (archive.raw_row->>'wins')::integer >= 0
  AND (archive.raw_row->>'games')::integer >= 0
  AND (archive.raw_row->'tier' = 'null'::jsonb OR (
    length(archive.raw_row->>'tier') <= 64 AND archive.raw_row->>'tier' ~ '[^[:space:]]'
  ))`

async function materializeHistory(sql: Sql, sourceKeys: string[]): Promise<void> {
  await sql.unsafe(
    `INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at)
     SELECT DISTINCT ON ((archive.raw_row->>'brawlhalla_id')::integer)
            (archive.raw_row->>'brawlhalla_id')::integer,
            (archive.raw_row->>'recorded_at')::timestamp AT TIME ZONE 'UTC'
     FROM players.legacy_archive archive
     WHERE archive.source_table = 'rating_history' AND archive.source_key = ANY($1::text[])
       AND ${validHistorySql}
     ORDER BY (archive.raw_row->>'brawlhalla_id')::integer,
              (archive.raw_row->>'recorded_at')::timestamp DESC, (archive.raw_row->>'id')::integer DESC
     ON CONFLICT DO NOTHING`,
    [sourceKeys],
  )
  await sql.unsafe(
    `INSERT INTO players.ranked_rating_history
       (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at,
        history_source, legacy_source_key, source_order)
     SELECT (archive.raw_row->>'brawlhalla_id')::integer,
            (archive.raw_row->>'rating')::integer, (archive.raw_row->>'peak_rating')::integer,
            archive.raw_row->>'tier', (archive.raw_row->>'wins')::integer,
            (archive.raw_row->>'games')::integer,
            (archive.raw_row->>'recorded_at')::timestamp AT TIME ZONE 'UTC',
            'v2-legacy', archive.source_key, (archive.raw_row->>'id')::bigint
     FROM players.legacy_archive archive
     WHERE archive.source_table = 'rating_history' AND archive.source_key = ANY($1::text[])
       AND ${validHistorySql}
     ON CONFLICT (legacy_source_key) WHERE history_source = 'v2-legacy' DO NOTHING`,
    [sourceKeys],
  )
  await sql.unsafe(
    `INSERT INTO players.legacy_import_rejections
       (source_table, source_key, code, evidence, archive_checksum)
     SELECT archive.source_table, archive.source_key, 'history-values-invalid',
            archive.raw_row, archive.row_checksum
     FROM players.legacy_archive archive
     WHERE archive.source_table = 'rating_history' AND archive.source_key = ANY($1::text[])
       AND NOT (${validHistorySql})
     ON CONFLICT DO NOTHING`,
    [sourceKeys],
  )
  await sql.unsafe(
    `INSERT INTO players.legacy_import_ledger
       (source_table, source_key, archive_checksum, outcome)
     SELECT archive.source_table, archive.source_key, archive.row_checksum,
            CASE WHEN ${validHistorySql} THEN 'transformed' ELSE 'rejected' END
     FROM players.legacy_archive archive
     WHERE archive.source_table = 'rating_history' AND archive.source_key = ANY($1::text[])
     ON CONFLICT DO NOTHING`,
    [sourceKeys],
  )
}

async function enqueueDiscoveryBatch(sql: Sql, brawlhallaIds: number[]): Promise<void> {
  const identities = [...new Set(brawlhallaIds.filter((identity) => Number.isSafeInteger(identity) && identity > 0))]
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

async function progressReconciliation(client: Sql): Promise<Reconciliation> {
  const [counts] = await client<
    Array<{
      source_rows: number
      archived_rows: number
      imported_aliases: number
      imported_history: number
      rejected_rows: number
    }>
  >`
    SELECT
      (SELECT count(*)::integer FROM public.player_alias) +
        (SELECT count(*)::integer FROM public.rating_history) AS source_rows,
      (SELECT count(*)::integer FROM players.legacy_archive
       WHERE source_table IN ('player_alias', 'rating_history')) AS archived_rows,
      (SELECT count(*)::integer FROM players.legacy_discovery_aliases) AS imported_aliases,
      (SELECT count(*)::integer FROM players.ranked_rating_history
       WHERE history_source = 'v2-legacy') AS imported_history,
      (SELECT count(*)::integer FROM players.legacy_import_rejections
       WHERE source_table IN ('player_alias', 'rating_history')) AS rejected_rows
  `
  return {
    sourceRows: counts.source_rows,
    archivedRows: counts.archived_rows,
    importedAliases: counts.imported_aliases,
    importedHistory: counts.imported_history,
    rejectedRows: counts.rejected_rows,
    sourceExact: false,
    destinationExact: false,
    exact: false,
  }
}

async function reconcile(client: Sql): Promise<Reconciliation> {
  const [result] = await client<
    Array<{
      source_rows: number
      archived_rows: number
      imported_aliases: number
      imported_history: number
      rejected_rows: number
      source_exact: boolean
      destination_exact: boolean
    }>
  >`
    WITH source AS (
      SELECT 'player_alias'::text AS source_table,
             jsonb_build_array(row.brawlhalla_id, row.key)::text AS source_key,
             row.brawlhalla_id, to_jsonb(row) AS raw_row
      FROM public.player_alias row
      UNION ALL
      SELECT 'rating_history', row.id::text, row.brawlhalla_id, to_jsonb(row)
      FROM public.rating_history row
    ), archive AS (
      SELECT * FROM players.legacy_archive
      WHERE source_table IN ('player_alias', 'rating_history')
    ), evidence AS (
      SELECT archive.*,
             ledger.outcome, ledger.archive_checksum AS ledger_checksum,
             alias.brawlhalla_id AS alias_id, alias.normalized_alias, alias.display_alias,
             alias.observed_at AS alias_observed_at, alias.archive_checksum AS alias_checksum,
             history.id AS history_id, history.brawlhalla_id AS history_player_id,
             history.rating AS history_rating, history.peak_rating AS history_peak_rating,
             history.tier AS history_tier, history.wins AS history_wins, history.games AS history_games,
             history.recorded_at AS history_recorded_at, history.source_order,
             rejection.rejection_count, rejection.rejection_checksum_exact,
             rejection.rejection_code
      FROM archive
      LEFT JOIN players.legacy_import_ledger ledger USING (source_table, source_key)
      LEFT JOIN players.legacy_discovery_aliases alias
        ON archive.source_table = 'player_alias' AND alias.archive_checksum = archive.row_checksum
      LEFT JOIN players.ranked_rating_history history
        ON archive.source_table = 'rating_history' AND history.history_source = 'v2-legacy'
       AND history.legacy_source_key = archive.source_key
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS rejection_count,
               bool_and(item.archive_checksum = archive.row_checksum) AS rejection_checksum_exact,
               min(item.code) AS rejection_code
        FROM players.legacy_import_rejections item
        WHERE item.source_table = archive.source_table AND item.source_key = archive.source_key
      ) rejection ON true
    )
    SELECT
      (SELECT count(*)::integer FROM source) AS source_rows,
      (SELECT count(*)::integer FROM archive) AS archived_rows,
      (SELECT count(*)::integer FROM players.legacy_discovery_aliases) AS imported_aliases,
      (SELECT count(*)::integer FROM players.ranked_rating_history
       WHERE history_source = 'v2-legacy') AS imported_history,
      (SELECT count(*)::integer FROM players.legacy_import_rejections
       WHERE source_table IN ('player_alias', 'rating_history')) AS rejected_rows,
      NOT EXISTS (
        SELECT 1 FROM source
        FULL JOIN archive USING (source_table, source_key)
        WHERE source.source_key IS NULL OR archive.source_key IS NULL
           OR archive.brawlhalla_id IS DISTINCT FROM source.brawlhalla_id
           OR archive.raw_row IS DISTINCT FROM source.raw_row
           OR archive.row_checksum <> encode(sha256(convert_to(source.raw_row::text, 'UTF8')), 'hex')
           OR archive.content_checksum <> encode(sha256(convert_to(archive.raw_row::text, 'UTF8')), 'hex')
      ) AS source_exact,
      NOT EXISTS (
        SELECT 1 FROM evidence
        WHERE outcome IS NULL OR ledger_checksum <> row_checksum
           OR CASE source_table
             WHEN 'player_alias' THEN CASE outcome
               WHEN 'transformed' THEN alias_id IS NULL
                 OR normalized_alias IS DISTINCT FROM lower(raw_row->>'value')
                 OR display_alias IS DISTINCT FROM raw_row->>'value'
                 OR alias_observed_at <> ((raw_row->>'created_at')::timestamp AT TIME ZONE 'UTC')
                 OR alias_checksum <> row_checksum OR rejection_count <> 0
               WHEN 'rejected' THEN alias_id IS NOT NULL OR rejection_count <> 1
                 OR NOT rejection_checksum_exact
                 OR rejection_code NOT IN ('alias-identity-invalid', 'alias-normalization-collision')
               ELSE true
             END
             WHEN 'rating_history' THEN CASE outcome
               WHEN 'transformed' THEN history_id IS NULL
                 OR history_player_id <> (raw_row->>'brawlhalla_id')::integer
                 OR history_rating <> (raw_row->>'rating')::integer
                 OR history_peak_rating <> (raw_row->>'peak_rating')::integer
                 OR history_tier IS DISTINCT FROM raw_row->>'tier'
                 OR history_wins <> (raw_row->>'wins')::integer
                 OR history_games <> (raw_row->>'games')::integer
                 OR history_recorded_at <> ((raw_row->>'recorded_at')::timestamp AT TIME ZONE 'UTC')
                 OR source_order <> (raw_row->>'id')::bigint OR rejection_count <> 0
               WHEN 'rejected' THEN history_id IS NOT NULL OR rejection_count <> 1
                 OR NOT rejection_checksum_exact OR rejection_code NOT IN (
                   'history-player-identity-invalid',
                   'history-rating-invalid',
                   'history-peak-rating-invalid',
                   'history-tier-unavailable',
                   'history-record-invalid',
                   'history-timestamp-invalid',
                   'history-order-invalid',
                   'history-values-invalid'
                 )
               ELSE true
             END
             ELSE true
           END
      )
      AND NOT EXISTS (
        SELECT 1 FROM players.legacy_import_ledger destination
        LEFT JOIN archive USING (source_table, source_key)
        WHERE destination.source_table IN ('player_alias', 'rating_history') AND archive.source_key IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM players.legacy_discovery_aliases destination
        LEFT JOIN archive ON archive.source_table = 'player_alias'
         AND archive.row_checksum = destination.archive_checksum
        WHERE archive.source_key IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM players.ranked_rating_history destination
        LEFT JOIN archive ON archive.source_table = 'rating_history'
         AND archive.source_key = destination.legacy_source_key
        WHERE destination.history_source = 'v2-legacy' AND archive.source_key IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM players.legacy_import_rejections destination
        LEFT JOIN archive USING (source_table, source_key)
        WHERE destination.source_table IN ('player_alias', 'rating_history') AND archive.source_key IS NULL
      ) AS destination_exact
  `
  const exact = result.source_exact && result.destination_exact && result.source_rows === result.archived_rows
  return {
    sourceRows: result.source_rows,
    archivedRows: result.archived_rows,
    importedAliases: result.imported_aliases,
    importedHistory: result.imported_history,
    rejectedRows: result.rejected_rows,
    sourceExact: result.source_exact,
    destinationExact: result.destination_exact,
    exact,
  }
}

export async function importLegacyReferenceHistory(
  connectionString: string,
  options: LegacyReferenceImportOptions = {},
): Promise<LegacyReferenceImportResult> {
  const { batchSize, maxBatches } = validateOptions(options)
  const client = postgres(connectionString, { max: 1 })
  let locked = false
  try {
    await client.unsafe("SET TIME ZONE 'UTC'")
    await client`SELECT pg_advisory_lock(${IMPORT_LOCK_KEY})`
    locked = true
    await client.unsafe('SET statement_timeout = 0')

    let stage: SourceTable = 'player_alias'
    let lastSourceKey: string | null = null
    let batches = 0
    let completed = false
    while (!completed && batches < maxBatches) {
      const rows = await client.begin(async (transaction) => {
        const sql = transaction as unknown as Sql
        await sql.unsafe('LOCK TABLE public.player_alias, public.rating_history IN SHARE MODE')
        const batch = await readBatch(sql, stage, batchSize)
        if (batch.length === 0) return batch
        await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
        await archiveBatch(sql, stage, batch)
        const sourceKeys = batch.map((row) => row.source_key)
        if (stage === 'player_alias') await materializeAliases(sql, sourceKeys)
        else await materializeHistory(sql, sourceKeys)
        await enqueueDiscoveryBatch(
          sql,
          batch.map((row) => row.brawlhalla_id),
        )
        return batch
      })
      if (rows.length === 0) {
        if (stage === 'player_alias') {
          stage = 'rating_history'
          lastSourceKey = null
          continue
        }
        completed = true
        continue
      }
      lastSourceKey = rows.at(-1)?.source_key ?? lastSourceKey
      batches += 1
    }

    if (!completed) {
      return {
        status: 'in-progress',
        checkpoint: { stage, sourceKey: lastSourceKey },
        reconciliation: await progressReconciliation(client),
      }
    }
    const reconciliation = await reconcile(client)
    return {
      status: reconciliation.exact ? 'complete' : 'blocked',
      checkpoint: reconciliation.exact ? null : { stage, sourceKey: lastSourceKey },
      reconciliation,
    }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(${IMPORT_LOCK_KEY})`
    await client.end()
  }
}
