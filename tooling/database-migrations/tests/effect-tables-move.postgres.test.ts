import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { migratePostgres } from '@brawltome/foundation'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

// the release being replaced: its statements name the old tables, and it may be serving while this migrates
const movingIdentities = new Set(['accounts/0011', 'players/0021', 'rankings/0013', 'statistics/0005'])

const serverUrl = process.env.DATABASE_URL
const describeWithDatabase = serverUrl ? describe : describe.skip

const databaseName = `effect_move_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const runtimeRole = `effect_runtime_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const deadLetterRole = 'brawltome_dead_letter'

// the same order configure-dead-letter-role.sh has granted them in since these tables existed
const deadLetterTablesAtOldNames = [
  'proof_effects',
  'leaderboard_effects',
  'statistics_collection_effects',
  'statistics_publication_effects',
  'statistics_legend_meta_publication_effects',
  'statistics_collection_seals',
]

let databaseUrl: string
let owner: postgres.Sql
// one connection, so the statements it prepared before the move are still cached after it
let oldRelease: postgres.Sql
let admin: postgres.Sql

const watermark = new Date('2026-08-10T00:00:00.000Z')

const leaderboardOperationId = randomUUID()
const leaderboardOperationKey = `leaderboard:${leaderboardOperationId}`
const leaderboardKind = 'leaderboard-1v1'
const leaderboardPayload = { mode: '1v1', pageDepth: 1, intervalMs: 60_000 }

const crawlWindow = new Date('2026-08-11T00:00:00.000Z')

const statisticsLeaseOwner = 'old-release-worker'
const statisticsCohortId = randomUUID()
const collectionOperationId = randomUUID()
const collectionOperationKey = `statistics-collection:${collectionOperationId}`
const collectionKind = 'statistics-ranked-collection'
const collectionPayload = { cohortId: statisticsCohortId, brawlhallaId: 42 }
const sealedCollectionOperationId = randomUUID()
const publicationOperationId = randomUUID()
const generationId = randomUUID()

const proofOperationId = randomUUID()
const proofOperationKey = `proof:${proofOperationId}`
const proofPayload = { value: 'seeded proof' }

function urlForDatabase(name: string): string {
  const url = new URL(serverUrl as string)

  url.pathname = `/${name}`

  return url.toString()
}

type LeasedOperation = {
  id: string
  kind: string
  operationKey: string
  payload: Record<string, unknown>
  status?: string
  workClass?: string
}

type OldRunner = postgres.Sql

async function insertOperation(operation: LeasedOperation): Promise<void> {
  const status = operation.status ?? 'leased'

  await owner`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
       status, attempt_count, max_attempts, lease_token, lease_owner, lease_expires_at, completed_at)
    VALUES (${operation.id}, ${operation.id}, ${operation.kind}, ${`dedupe:${operation.id}`}, ${operation.operationKey},
            ${operation.workClass ?? 'maintenance'}, ${owner.json(operation.payload as never)},
            ${owner.json({ source: 'effect-tables-move-test', requestedBy: 'test' })},
            ${status}, 1, 3, 1, ${status === 'leased' ? 'old-release-worker' : null},
            ${status === 'leased' ? new Date(Date.now() + 3_600_000) : null},
            ${status === 'succeeded' || status === 'dead_letter' ? new Date() : null})
  `
}

// the role configure-dead-letter-role.sh gives this access to on the released schema, so this matches production
async function grantOldDeadLetterAccess(): Promise<void> {
  await owner.unsafe(`GRANT USAGE ON SCHEMA refresh_operations TO ${deadLetterRole}`)

  for (const table of deadLetterTablesAtOldNames) {
    await owner.unsafe(`GRANT SELECT ON refresh_operations.${table} TO ${deadLetterRole}`)
  }
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await condition()) return

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error(`condition not met within ${timeoutMs} ms`)
}

async function seedRowsBeforeTheMove(): Promise<void> {
  await insertOperation({
    id: collectionOperationId,
    kind: collectionKind,
    operationKey: collectionOperationKey,
    payload: collectionPayload,
    workClass: 'global-statistics',
    status: 'dead_letter',
  })

  await owner`
    INSERT INTO refresh_operations.statistics_collection_effects (operation_key, operation_id, kind, lease_token)
    VALUES (${`seeded:${collectionOperationKey}`}, ${collectionOperationId}, ${collectionKind}, 1)
  `

  await insertOperation({
    id: sealedCollectionOperationId,
    kind: collectionKind,
    operationKey: `sealed:${sealedCollectionOperationId}`,
    payload: collectionPayload,
    workClass: 'global-statistics',
    status: 'dead_letter',
  })

  await insertOperation({
    id: publicationOperationId,
    kind: 'statistics-publication',
    operationKey: `publication:${publicationOperationId}`,
    payload: { generationId, product: 'ranked' },
    workClass: 'global-statistics',
    status: 'dead_letter',
  })

  await owner`
    INSERT INTO refresh_operations.statistics_collection_seals (collection_operation_id, publication_operation_id)
    VALUES (${sealedCollectionOperationId}, ${publicationOperationId})
  `

  await owner`
    INSERT INTO refresh_operations.statistics_publication_effects (operation_key, operation_id, lease_token)
    VALUES (${`seeded:publication:${publicationOperationId}`}, ${publicationOperationId}, 1)
  `

  await owner`
    INSERT INTO refresh_operations.statistics_legend_meta_publication_effects (operation_key, operation_id, lease_token)
    VALUES (${`seeded:legend-meta:${publicationOperationId}`}, ${publicationOperationId}, 1)
  `

  await insertOperation({
    id: leaderboardOperationId,
    kind: leaderboardKind,
    operationKey: leaderboardOperationKey,
    payload: leaderboardPayload,
    workClass: 'leaderboard',
  })

  await owner`
    INSERT INTO refresh_operations.leaderboard_effects (operation_key, operation_id, operation_kind, lease_token)
    VALUES (${`seeded:${leaderboardOperationKey}`}, ${leaderboardOperationId}, ${leaderboardKind}, 1)
  `

  await owner`
    INSERT INTO refresh_operations.leaderboard_deep_crawl_progress (region, window_at, next_page, total_pages)
    VALUES ('EU', ${crawlWindow}, 2, 40)
  `

  await owner`
    INSERT INTO refresh_operations.leaderboard_deep_crawl_mode_progress (mode, region, window_at, next_page, total_pages)
    VALUES ('2v2', 'EU', ${crawlWindow}, 3, 50)
  `

  await insertOperation({
    id: proofOperationId,
    kind: 'proof',
    operationKey: proofOperationKey,
    payload: proofPayload,
  })

  await owner`
    INSERT INTO refresh_operations.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${`seeded:${proofOperationKey}`}, ${proofOperationId}, 1, ${owner.json(proofPayload)})
  `

  await owner`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${watermark})
  `
}

async function readWatermarkForUpdate(sql: OldRunner): Promise<Date | undefined> {
  const [previous] = await sql<{ observed_at: Date }[]>`
    SELECT observed_at
    FROM refresh_operations.primary_monitoring_reconciliation
    WHERE singleton
    FOR UPDATE
  `

  return previous?.observed_at
}

async function upsertWatermark(sql: OldRunner, observedAt: Date): Promise<void> {
  await sql`
    INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
    VALUES (true, ${observedAt})
    ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
  `
}

async function oldProofEffectInsert(sql: OldRunner, operationKey: string, operationId: string) {
  return sql<{ operation_key: string }[]>`
    INSERT INTO refresh_operations.proof_effects (operation_key, operation_id, lease_token, effect_value)
    VALUES (${operationKey}, ${operationId}, ${1}, ${sql.json(proofPayload)})
    ON CONFLICT (operation_key) DO NOTHING
    RETURNING operation_key
  `
}

async function oldProofEffectRead(sql: OldRunner, operationKey: string) {
  const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
    SELECT operation_id, effect_value = ${sql.json(proofPayload)}::jsonb AS matches_payload
    FROM refresh_operations.proof_effects
    WHERE operation_key = ${operationKey}
  `

  return existing
}

async function oldProofEffectState(sql: OldRunner, effectOperationId: string) {
  return sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.proof_effects
    WHERE operation_id = ${effectOperationId}
  `
}

// the old release's deep-crawl progress statements, verbatim
async function oldReadCrawlProgress(sql: OldRunner, region: string) {
  return sql<{ window_at: Date; next_page: number; total_pages: number }[]>`
    SELECT window_at, next_page, total_pages
    FROM refresh_operations.leaderboard_deep_crawl_progress WHERE region = ${region}
  `
}

async function oldSaveCrawlProgress(
  sql: OldRunner,
  region: string,
  windowAt: Date,
  nextPage: number,
  totalPages: number,
) {
  await sql`
    INSERT INTO refresh_operations.leaderboard_deep_crawl_progress (region, window_at, next_page, total_pages)
    VALUES (${region}, ${windowAt}, ${nextPage}, ${totalPages})
    ON CONFLICT (region) DO UPDATE SET
      window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
      total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
  `
}

async function oldReadCrawlModeProgress(sql: OldRunner, mode: string, region: string) {
  return sql<{ window_at: Date; next_page: number; total_pages: number }[]>`
    SELECT window_at, next_page, total_pages
    FROM refresh_operations.leaderboard_deep_crawl_mode_progress WHERE mode = ${mode} AND region = ${region}
  `
}

async function oldSaveCrawlModeProgress(sql: OldRunner, mode: string, region: string, nextPage: number) {
  await sql`
    INSERT INTO refresh_operations.leaderboard_deep_crawl_mode_progress
      (mode, region, window_at, next_page, total_pages)
    VALUES (${mode}, ${region}, ${crawlWindow}, ${nextPage}, ${60})
    ON CONFLICT (mode, region) DO UPDATE SET
      window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
      total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
  `
}

async function oldLeaderboardEffectState(sql: OldRunner, effectOperationId: string) {
  return sql<{ operation_id: string }[]>`
    SELECT operation_id FROM refresh_operations.leaderboard_effects
    WHERE operation_id = ${effectOperationId}
  `
}

async function oldRecordLeaderboardEffect(sql: OldRunner, operationId: string, operationKey: string) {
  const [result] = await sql<{ result: string }[]>`
    SELECT refresh_operations.record_leaderboard_effect(
      ${operationId},
      ${operationKey},
      ${leaderboardKind},
      ${'old-release-worker'},
      ${1}
    ) AS result
  `

  return result.result
}

// the old release's statistics effect statements, verbatim
async function oldCollectionEffectRead(sql: OldRunner, effectOperationId: string, operationKey: string) {
  return sql<{ operation_id: string; operation_key: string; kind: string }[]>`
    SELECT effect.operation_id, effect.operation_key, effect.kind
    FROM refresh_operations.statistics_collection_effects effect
    WHERE effect.operation_id = ${effectOperationId} OR effect.operation_key = ${operationKey}
  `
}

async function oldPublicationEffectRead(sql: OldRunner, effectOperationId: string) {
  return sql<{ operation_id: string; operation_key: string }[]>`
    SELECT effect.operation_id, effect.operation_key
    FROM refresh_operations.statistics_publication_effects effect
    WHERE effect.operation_id = ${effectOperationId}
  `
}

async function oldLegendMetaEffectRead(sql: OldRunner, effectOperationId: string) {
  return sql<{ operation_id: string }[]>`
    SELECT operation_id
    FROM refresh_operations.statistics_legend_meta_publication_effects
    WHERE operation_id = ${effectOperationId}
  `
}

async function oldSealRead(sql: OldRunner, collectionOperationId: string) {
  return sql<{ collection_operation_id: string }[]>`
    SELECT collection_operation_id FROM refresh_operations.statistics_collection_seals
    WHERE collection_operation_id = ${collectionOperationId}
  `
}

async function oldSealInsert(sql: OldRunner, collectionId: string, publicationId: string) {
  return sql`
    INSERT INTO refresh_operations.statistics_collection_seals (collection_operation_id, publication_operation_id)
    SELECT ${collectionId}::uuid, ${publicationId}::uuid
    ON CONFLICT (collection_operation_id) DO NOTHING
  `
}

async function oldRecordCollectionEffect(sql: OldRunner, operationId: string, operationKey: string) {
  const [effect] = await sql<{ result: string }[]>`
    SELECT refresh_operations.record_statistics_collection_effect(
      ${operationId}, ${operationKey}, ${collectionKind},
      ${statisticsLeaseOwner}, ${1}
    ) AS result
  `

  return effect.result
}

async function oldSealCollections(sql: OldRunner, publicationId: string, collectionIds: string[]) {
  const [seal] = await sql<{ result: string }[]>`
    SELECT refresh_operations.seal_statistics_collections_for_publication(
      ${publicationId},
      ${collectionIds}::uuid[]
    ) AS result
  `

  return seal.result
}

async function oldRecordPublicationEffect(sql: OldRunner, operationId: string, operationKey: string) {
  const [effect] = await sql<{ result: string }[]>`
    SELECT refresh_operations.record_statistics_publication_effect(
      ${operationId}, ${operationKey},
      ${statisticsLeaseOwner}, ${1},
      ${[]}::uuid[]
    ) AS result
  `

  return effect.result
}

async function oldRecordLegendMetaEffect(sql: OldRunner, operationId: string, operationKey: string) {
  const [effect] = await sql<{ result: string }[]>`
    SELECT refresh_operations.record_statistics_legend_meta_publication_effect(
      ${operationId}, ${operationKey},
      ${statisticsLeaseOwner}, ${1}
    ) AS result
  `

  return effect.result
}

async function prepareOldStatements(): Promise<void> {
  await oldRelease.begin(async (transactionHandle) => {
    const transaction = transactionHandle as unknown as OldRunner

    await readWatermarkForUpdate(transaction)
    await upsertWatermark(transaction, watermark)
    // the conflict path, so the seeded row stays as it was
    await oldProofEffectInsert(transaction, `seeded:${proofOperationKey}`, proofOperationId)
    await oldProofEffectRead(transaction, `seeded:${proofOperationKey}`)
    await oldProofEffectState(transaction, proofOperationId)
    await oldReadCrawlProgress(transaction, 'EU')
    await oldSaveCrawlProgress(transaction, 'EU', crawlWindow, 2, 40)
    await oldReadCrawlModeProgress(transaction, '2v2', 'EU')
    await oldSaveCrawlModeProgress(transaction, '2v2', 'EU', 3)
    await oldLeaderboardEffectState(transaction, leaderboardOperationId)

    expect(await oldRecordLeaderboardEffect(transaction, leaderboardOperationId, leaderboardOperationKey)).toBe(
      'effect-conflict',
    )

    await oldCollectionEffectRead(transaction, collectionOperationId, collectionOperationKey)
    await oldPublicationEffectRead(transaction, publicationOperationId)
    await oldLegendMetaEffectRead(transaction, publicationOperationId)
    await oldSealRead(transaction, sealedCollectionOperationId)
    await oldSealInsert(transaction, sealedCollectionOperationId, publicationOperationId)
    await oldRecordCollectionEffect(transaction, collectionOperationId, collectionOperationKey)
    await oldSealCollections(transaction, randomUUID(), [])
    await oldRecordPublicationEffect(transaction, randomUUID(), `publication:${randomUUID()}`)
    await oldRecordLegendMetaEffect(transaction, randomUUID(), `legend-meta:${randomUUID()}`)
  })
}

beforeAll(async () => {
  if (!serverUrl) return

  admin = postgres(urlForDatabase('postgres'), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  await admin.unsafe(`CREATE ROLE "${runtimeRole}" NOLOGIN NOSUPERUSER`)
  await admin.unsafe(`DROP ROLE IF EXISTS ${deadLetterRole}`).catch(() => undefined)
  await admin.unsafe(`CREATE ROLE ${deadLetterRole} NOLOGIN NOSUPERUSER`).catch(() => undefined)

  databaseUrl = urlForDatabase(databaseName)
  owner = postgres(databaseUrl, { max: 1 })

  // production grants these once at database creation; every later object inherits them
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO "${runtimeRole}"`)
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${runtimeRole}"`)
  await owner.unsafe(`ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${runtimeRole}"`)

  await migratePostgres(
    databaseUrl,
    orderedMigrations.filter(({ identity }) => !movingIdentities.has(identity)),
  )

  await seedRowsBeforeTheMove()
  await grantOldDeadLetterAccess()

  oldRelease = postgres(databaseUrl, { max: 1 })
  await prepareOldStatements()

  await migratePostgres(databaseUrl, orderedMigrations)
}, 60_000)

afterAll(async () => {
  if (!serverUrl) return

  await oldRelease?.end()
  await owner?.end()
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin?.unsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
  await admin?.unsafe(`DROP ROLE IF EXISTS ${deadLetterRole}`).catch(() => undefined)
  await admin?.end()
}, 30_000)

// these statements run the same way the released script does after the move, for example on a rollback
const releasedDeadLetterGrantStatements = [
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA refresh_operations FROM ${deadLetterRole}`,
  ...deadLetterTablesAtOldNames.map((table) => `GRANT SELECT ON refresh_operations.${table} TO ${deadLetterRole}`),
]

const moveMigrations = orderedMigrations.filter(({ identity }) => movingIdentities.has(identity))

// every object in the schemas this change touches, so a fresh database can be compared with one that was migrated
const catalogSnapshotSql = `
  SELECT 'column' AS object, n.nspname || '.' || c.relname || '.' || a.attname AS name,
         format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' ||
         coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS detail
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'v', 'p')
    AND n.nspname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics')
  UNION ALL
  SELECT 'constraint', n.nspname || '.' || c.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics')
  UNION ALL
  SELECT 'index', schemaname || '.' || indexname, indexdef FROM pg_indexes
  WHERE schemaname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics')
  UNION ALL
  SELECT 'view', schemaname || '.' || viewname, definition FROM pg_views
  WHERE schemaname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics') AND p.prokind = 'f'
  UNION ALL
  SELECT 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname IN ('refresh_operations', 'accounts', 'rankings', 'players', 'statistics')
  ORDER BY 1, 2
`

describeWithDatabase('moving queue effect tables to their owners', () => {
  test('a fresh database ends up identical to one migrated from the release before this', async () => {
    const freshName = `effect_move_fresh_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

    await admin.unsafe(`CREATE DATABASE "${freshName}"`)

    try {
      const freshUrl = urlForDatabase(freshName)

      await migratePostgres(freshUrl, orderedMigrations)

      const fresh = postgres(freshUrl, { max: 1 })

      try {
        const freshCatalog = [...(await fresh.unsafe(catalogSnapshotSql))]
        const migratedCatalog = [...(await owner.unsafe(catalogSnapshotSql))]

        expect(migratedCatalog).toEqual(freshCatalog)
      } finally {
        await fresh.end()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${freshName}" WITH (FORCE)`)
    }
  }, 60_000)

  test('every move sets a short lock timeout and takes its table locks in a fixed order', () => {
    for (const migration of moveMigrations) {
      expect(migration.sql.startsWith("SET LOCAL lock_timeout = '5s';")).toBe(true)
    }

    const statistics = moveMigrations.find(({ identity }) => identity === 'statistics/0005')?.sql ?? ''
    const publicationLock = statistics.indexOf('refresh_operations.statistics_publication_effects,')
    const sealLock = statistics.indexOf('refresh_operations.statistics_collection_seals,')

    expect(publicationLock).toBeGreaterThan(-1)
    expect(sealLock).toBeGreaterThan(publicationLock)
  })

  test('the dead-letter role keeps every grant it had on both names as soon as the migration commits', async () => {
    await owner.begin(async (transactionHandle) => {
      const transaction = transactionHandle as unknown as OldRunner

      await transaction.unsafe(`SET LOCAL ROLE ${deadLetterRole}`)

      for (const table of deadLetterTablesAtOldNames) {
        await transaction.unsafe(`SELECT count(*) FROM refresh_operations.${table}`)
      }

      await transaction`SELECT count(*) FROM accounts.proof_effects`
      await transaction`SELECT count(*) FROM rankings.leaderboard_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_collection_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_publication_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_legend_meta_publication_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_collection_seals`
    })
  })

  test('the released dead-letter script still works after the move, so a rollback keeps the role working', async () => {
    for (const statement of releasedDeadLetterGrantStatements) await owner.unsafe(statement)

    await owner.begin(async (transactionHandle) => {
      const transaction = transactionHandle as unknown as OldRunner

      await transaction.unsafe(`SET LOCAL ROLE ${deadLetterRole}`)

      for (const table of deadLetterTablesAtOldNames) {
        await transaction.unsafe(`SELECT count(*) FROM refresh_operations.${table}`)
      }
    })
  })

  test('the dead-letter role cannot write or read anything else through the moved names', async () => {
    await expect(
      owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE ${deadLetterRole}`)
        await transaction`DELETE FROM accounts.proof_effects`
      }),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE ${deadLetterRole}`)
        await transaction`SELECT count(*) FROM statistics.cohorts`
      }),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE ${deadLetterRole}`)
        await transaction`SELECT count(*) FROM accounts.users`
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  // the function bodies resolve operations%ROWTYPE, which takes ACCESS SHARE; workers never hold anything that blocks it
  test('the moves only need access share on the operations table', async () => {
    const lockDatabaseName = `effect_move_ops_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

    await admin.unsafe(`CREATE DATABASE "${lockDatabaseName}"`)

    const lockUrl = urlForDatabase(lockDatabaseName)

    await migratePostgres(
      lockUrl,
      orderedMigrations.filter(({ identity }) => !movingIdentities.has(identity)),
    )

    const holder = postgres(lockUrl, { max: 1 })

    try {
      let release: () => void = () => undefined

      const released = new Promise<void>((resolve) => {
        release = resolve
      })

      const holding = holder.begin(async (transaction) => {
        await transaction`LOCK TABLE refresh_operations.operations IN EXCLUSIVE MODE`
        await released
      })

      // waits for the holder to get the lock, so the moves below really run while it is held
      await waitUntil(async () => {
        const verifier = postgres(lockUrl, { max: 1 })

        try {
          const [row] = await verifier<{ held: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
              WHERE l.granted AND l.mode = 'ExclusiveLock' AND c.relname = 'operations'
            ) AS held
          `

          return row.held
        } finally {
          await verifier.end()
        }
      })

      try {
        await migratePostgres(lockUrl, orderedMigrations)
      } finally {
        release()
      }

      await holding
    } finally {
      await holder.end()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${lockDatabaseName}" WITH (FORCE)`)
    }
  }, 60_000)

  test('a worker part way through a publication record can finish while the migration waits behind it', async () => {
    const lockDatabaseName = `effect_move_locks_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

    await admin.unsafe(`CREATE DATABASE "${lockDatabaseName}"`)

    const lockUrl = urlForDatabase(lockDatabaseName)

    await migratePostgres(
      lockUrl,
      orderedMigrations.filter(({ identity }) => !movingIdentities.has(identity)),
    )

    const worker = postgres(lockUrl, { max: 1 })
    const observer = postgres(lockUrl, { max: 1 })

    try {
      let release: () => void = () => undefined

      const released = new Promise<void>((resolve) => {
        release = resolve
      })

      const workerDone = worker.begin(async (transaction) => {
        await transaction`SELECT count(*) FROM refresh_operations.statistics_publication_effects`
        await released
        await transaction`SELECT count(*) FROM refresh_operations.statistics_collection_seals`
      })

      const migrating = migratePostgres(lockUrl, orderedMigrations)

      await waitUntil(async () => {
        const [row] = await observer<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks l
            JOIN pg_class c ON c.oid = l.relation
            WHERE NOT l.granted AND l.mode = 'AccessExclusiveLock' AND c.relname = 'statistics_publication_effects'
          ) AS waiting
        `

        return row.waiting
      })

      release()
      await workerDone
      await migrating

      const [moved] = await observer<{ moved: string | null }[]>`
        SELECT to_regclass('statistics.statistics_publication_effects')::text AS moved
      `

      expect(moved.moved).toBe('statistics.statistics_publication_effects')
    } finally {
      await worker.end()
      await observer.end()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${lockDatabaseName}" WITH (FORCE)`)
    }
  }, 60_000)

  describe('statistics effect tables', () => {
    test('owner schema holds the rows seeded before the move', async () => {
      const [effect] = await owner<{ operation_id: string; kind: string }[]>`
        SELECT operation_id, kind FROM statistics.statistics_collection_effects
        WHERE operation_key = ${`seeded:${collectionOperationKey}`}
      `

      expect(effect).toEqual({ operation_id: collectionOperationId, kind: collectionKind })

      const [seal] = await owner<{ publication_operation_id: string }[]>`
        SELECT publication_operation_id FROM statistics.statistics_collection_seals
        WHERE collection_operation_id = ${sealedCollectionOperationId}
      `

      expect(seal.publication_operation_id).toBe(publicationOperationId)

      const [publication] = await owner<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.statistics_publication_effects WHERE operation_id = ${publicationOperationId}
      `

      expect(publication.operation_id).toBe(publicationOperationId)

      const [legendMeta] = await owner<{ operation_id: string }[]>`
        SELECT operation_id FROM statistics.statistics_legend_meta_publication_effects
        WHERE operation_id = ${publicationOperationId}
      `

      expect(legendMeta.operation_id).toBe(publicationOperationId)
    })

    test('old names take the old statements from a session prepared before the move', async () => {
      const effects = await oldCollectionEffectRead(oldRelease, collectionOperationId, collectionOperationKey)

      expect(effects.length).toBe(1)

      const [publication] = await oldPublicationEffectRead(oldRelease, publicationOperationId)

      expect(publication.operation_id).toBe(publicationOperationId)

      expect([...(await oldLegendMetaEffectRead(oldRelease, publicationOperationId))]).toEqual([
        { operation_id: publicationOperationId },
      ])

      expect([...(await oldSealRead(oldRelease, sealedCollectionOperationId))]).toEqual([
        { collection_operation_id: sealedCollectionOperationId },
      ])

      const unsealed = randomUUID()

      await insertOperation({
        id: unsealed,
        kind: collectionKind,
        operationKey: `unsealed:${unsealed}`,
        payload: collectionPayload,
        workClass: 'global-statistics',
        status: 'dead_letter',
      })

      await oldSealInsert(oldRelease, unsealed, publicationOperationId)
      await oldSealInsert(oldRelease, unsealed, publicationOperationId)

      const [viewSeal] = await owner<{ publication_operation_id: string }[]>`
        SELECT publication_operation_id FROM statistics.statistics_collection_seals
        WHERE collection_operation_id = ${unsealed}
      `

      expect(viewSeal.publication_operation_id).toBe(publicationOperationId)
    })

    test('the foreign key to operations still holds at the new name', async () => {
      await expect(oldSealInsert(oldRelease, randomUUID(), publicationOperationId)).rejects.toMatchObject({
        code: '23503',
      })
    })

    test('the old function names run through the owner bodies', async () => {
      const collectionId = randomUUID()
      const collectionKey = `old-collection:${collectionId}`

      await insertOperation({
        id: collectionId,
        kind: collectionKind,
        operationKey: collectionKey,
        payload: collectionPayload,
        workClass: 'global-statistics',
      })

      expect(await oldRecordCollectionEffect(oldRelease, collectionId, collectionKey)).toBe('applied')
      expect(await oldRecordCollectionEffect(oldRelease, collectionId, collectionKey)).toBe('already-applied')

      const [storedCollection] = await owner<{ operation_key: string }[]>`
        SELECT operation_key FROM statistics.statistics_collection_effects WHERE operation_id = ${collectionId}
      `

      expect(storedCollection.operation_key).toBe(collectionKey)

      const publicationId = randomUUID()
      const publicationKey = `old-publication:${publicationId}`

      await insertOperation({
        id: publicationId,
        kind: 'statistics-publication',
        operationKey: publicationKey,
        payload: { generationId, product: 'ranked' },
        workClass: 'global-statistics',
      })

      expect(await oldRecordPublicationEffect(oldRelease, publicationId, publicationKey)).toBe('applied')
      expect(await oldRecordPublicationEffect(oldRelease, publicationId, publicationKey)).toBe('already-applied')

      const legendMetaId = randomUUID()
      const legendMetaKey = `old-legend:${legendMetaId}`

      await insertOperation({
        id: legendMetaId,
        kind: 'statistics-legend-meta-publication',
        operationKey: legendMetaKey,
        payload: { generationId: randomUUID() },
        workClass: 'global-statistics',
      })

      // no publication binding exists for this operation, so the owner body's first statistics check reports it
      expect(await oldRecordLegendMetaEffect(oldRelease, legendMetaId, legendMetaKey)).toBe('effect-conflict')

      const bindingPublicationId = randomUUID()

      await insertOperation({
        id: bindingPublicationId,
        kind: 'statistics-publication',
        operationKey: `old-binding:${bindingPublicationId}`,
        payload: { generationId, product: 'ranked' },
        workClass: 'global-statistics',
        status: 'awaiting_binding',
      })

      expect(await oldSealCollections(oldRelease, bindingPublicationId, [])).toBe('sealed')
    })

    test('runtime role reads and writes both names and can call both functions', async () => {
      const collectionId = randomUUID()
      const collectionKey = `runtime-collection:${collectionId}`

      await insertOperation({
        id: collectionId,
        kind: collectionKind,
        operationKey: collectionKey,
        payload: collectionPayload,
        workClass: 'global-statistics',
      })

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        expect(await oldRecordCollectionEffect(transaction, collectionId, collectionKey)).toBe('applied')

        await transaction`
          SELECT statistics.record_statistics_collection_effect(
            ${collectionId}, ${collectionKey}, ${collectionKind}, ${statisticsLeaseOwner}, ${1}
          )
        `

        await transaction`SELECT operation_id FROM statistics.statistics_collection_effects WHERE operation_id = ${collectionId}`
        await oldSealRead(transaction, sealedCollectionOperationId)
      })
    })
  })

  describe('rankings effect tables', () => {
    test('owner schema holds the rows seeded before the move, with their foreign key', async () => {
      const [effect] = await owner<{ operation_id: string; operation_kind: string }[]>`
        SELECT operation_id, operation_kind FROM rankings.leaderboard_effects
        WHERE operation_key = ${`seeded:${leaderboardOperationKey}`}
      `

      expect(effect).toEqual({ operation_id: leaderboardOperationId, operation_kind: leaderboardKind })

      const [progress] = await owner<{ next_page: number }[]>`
        SELECT next_page FROM rankings.leaderboard_deep_crawl_progress WHERE region = 'EU'
      `

      expect(progress.next_page).toBe(2)

      const [modeProgress] = await owner<{ next_page: number }[]>`
        SELECT next_page FROM rankings.leaderboard_deep_crawl_mode_progress WHERE mode = '2v2' AND region = 'EU'
      `

      expect(modeProgress.next_page).toBe(3)

      await expect(
        owner`
          INSERT INTO rankings.leaderboard_effects (operation_key, operation_id, operation_kind, lease_token)
          VALUES (${`orphan:${randomUUID()}`}, ${randomUUID()}, ${leaderboardKind}, 1)
        `.execute(),
      ).rejects.toMatchObject({ code: '23503' })
    })

    test('old names take the old deep-crawl and effect statements from a session prepared before the move', async () => {
      const [before] = await oldReadCrawlProgress(oldRelease, 'EU')

      expect(before.next_page).toBe(2)

      const nextWindow = new Date(crawlWindow.getTime() + 86_400_000)

      await oldSaveCrawlProgress(oldRelease, 'EU', nextWindow, 5, 41)

      const [saved] = await owner<{ window_at: Date; next_page: number; total_pages: number; updated_at: Date }[]>`
        SELECT window_at, next_page, total_pages, updated_at FROM rankings.leaderboard_deep_crawl_progress
        WHERE region = 'EU'
      `

      expect(saved).toMatchObject({ window_at: nextWindow, next_page: 5, total_pages: 41 })

      await oldSaveCrawlModeProgress(oldRelease, '2v2', 'EU', 9)
      await oldSaveCrawlModeProgress(oldRelease, 'solo2v2', 'US-E', 1)

      const [modeSaved] = await oldReadCrawlModeProgress(oldRelease, '2v2', 'EU')

      expect(modeSaved.next_page).toBe(9)

      const [newMode] = await owner<{ next_page: number }[]>`
        SELECT next_page FROM rankings.leaderboard_deep_crawl_mode_progress WHERE mode = 'solo2v2' AND region = 'US-E'
      `

      expect(newMode.next_page).toBe(1)
    })

    test('the old function name still records an effect through the owner body', async () => {
      const operationId = randomUUID()
      const operationKey = `old-leaderboard:${operationId}`

      await insertOperation({
        id: operationId,
        kind: leaderboardKind,
        operationKey,
        payload: leaderboardPayload,
        workClass: 'leaderboard',
      })

      expect(await oldRecordLeaderboardEffect(oldRelease, operationId, operationKey)).toBe('applied')
      expect(await oldRecordLeaderboardEffect(oldRelease, operationId, operationKey)).toBe('already-applied')

      expect([...(await oldLeaderboardEffectState(oldRelease, operationId))]).toEqual([{ operation_id: operationId }])

      const [stored] = await owner<{ operation_key: string }[]>`
        SELECT operation_key FROM rankings.leaderboard_effects WHERE operation_id = ${operationId}
      `

      expect(stored.operation_key).toBe(operationKey)
    })

    test('runtime role reads and writes both names and can call both functions', async () => {
      const operationId = randomUUID()
      const operationKey = `runtime-leaderboard:${operationId}`

      await insertOperation({
        id: operationId,
        kind: leaderboardKind,
        operationKey,
        payload: leaderboardPayload,
        workClass: 'leaderboard',
      })

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        expect(await oldRecordLeaderboardEffect(transaction, operationId, operationKey)).toBe('applied')
        await oldLeaderboardEffectState(transaction, operationId)
        await oldSaveCrawlProgress(transaction, 'BRZ', crawlWindow, 2, 7)
        await transaction`SELECT next_page FROM rankings.leaderboard_deep_crawl_progress WHERE region = 'BRZ'`
      })

      await expect(
        (async () => {
          await owner.begin(async (transactionHandle) => {
            const transaction = transactionHandle as unknown as OldRunner

            await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)

            await transaction`
              SELECT rankings.record_leaderboard_effect(${operationId}, ${operationKey}, ${leaderboardKind}, ${'old-release-worker'}, ${1})
            `
          })
        })(),
      ).resolves.toBeUndefined()
    })
  })

  describe('accounts.proof_effects', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const rows = await owner<{ operation_id: string; effect_value: unknown }[]>`
        SELECT operation_id, effect_value FROM accounts.proof_effects WHERE operation_key = ${`seeded:${proofOperationKey}`}
      `

      expect([...rows]).toEqual([{ operation_id: proofOperationId, effect_value: proofPayload }])
    })

    test('old name is a view that accepts the old statements from a session prepared before the move', async () => {
      const operationKey = `old-release:${randomUUID()}`
      const operationId = randomUUID()

      await insertOperation({ id: operationId, kind: 'proof', operationKey, payload: proofPayload })

      const inserted = await oldProofEffectInsert(oldRelease, operationKey, operationId)

      expect([...inserted]).toEqual([{ operation_key: operationKey }])

      expect([...(await oldProofEffectInsert(oldRelease, operationKey, operationId))]).toEqual([])

      expect(await oldProofEffectRead(oldRelease, operationKey)).toEqual({
        operation_id: operationId,
        matches_payload: true,
      })

      expect([...(await oldProofEffectState(oldRelease, operationId))]).toEqual([{ operation_id: operationId }])

      const [stored] = await owner<{ operation_key: string; created_at: Date }[]>`
        SELECT operation_key, created_at FROM accounts.proof_effects WHERE operation_id = ${operationId}
      `

      expect(stored.operation_key).toBe(operationKey)
      expect(stored.created_at).toBeInstanceOf(Date)
    })

    test('the foreign key to operations still holds at the new name', async () => {
      await expect(oldProofEffectInsert(oldRelease, `orphan:${randomUUID()}`, randomUUID())).rejects.toMatchObject({
        code: '23503',
      })
    })

    test('runtime role reads and writes both names', async () => {
      const operationKey = `runtime:${randomUUID()}`
      const operationId = randomUUID()

      await insertOperation({ id: operationId, kind: 'proof', operationKey, payload: proofPayload })

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        await oldProofEffectInsert(transaction, operationKey, operationId)
        await transaction`SELECT operation_id FROM accounts.proof_effects WHERE operation_key = ${operationKey}`
      })
    })
  })

  describe('players.primary_monitoring_reconciliation', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const [row] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton
      `

      expect(row.observed_at).toEqual(watermark)
    })

    test('old name is a view that accepts the old statements from a session prepared before the move', async () => {
      const newer = new Date(watermark.getTime() + 1_000)

      await oldRelease.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        expect(await readWatermarkForUpdate(transaction)).toEqual(watermark)
        await upsertWatermark(transaction, newer)
      })

      const [viewed] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM refresh_operations.primary_monitoring_reconciliation WHERE singleton
      `

      expect(viewed.observed_at).toEqual(newer)

      const [stored] = await owner<{ observed_at: Date }[]>`
        SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton
      `

      expect(stored.observed_at).toEqual(newer)
    })

    test('runtime role reads and writes both names', async () => {
      const newer = new Date(watermark.getTime() + 2_000)

      await owner.begin(async (transactionHandle) => {
        const transaction = transactionHandle as unknown as OldRunner

        await transaction.unsafe(`SET LOCAL ROLE "${runtimeRole}"`)
        await readWatermarkForUpdate(transaction)
        await upsertWatermark(transaction, newer)

        await transaction`
          SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton FOR UPDATE
        `
      })
    })
  })
})
