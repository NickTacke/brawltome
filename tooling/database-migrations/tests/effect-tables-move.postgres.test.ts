import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type Migration, migratePostgres } from '@brawltome/foundation'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

const movingIdentities = new Set(['accounts/0011', 'players/0021', 'rankings/0013', 'statistics/0005'])
const droppingIdentities = new Set(['accounts/0012', 'players/0022', 'rankings/0014', 'statistics/0006'])

const compatibilityViews = [
  'proof_effects',
  'leaderboard_effects',
  'leaderboard_deep_crawl_progress',
  'leaderboard_deep_crawl_mode_progress',
  'primary_monitoring_reconciliation',
  'statistics_collection_effects',
  'statistics_collection_seals',
  'statistics_publication_effects',
  'statistics_legend_meta_publication_effects',
]

const compatibilityFunctions = [
  'record_leaderboard_effect(uuid,text,text,text,bigint)',
  'record_statistics_collection_effect(uuid,text,text,text,bigint)',
  'seal_statistics_collections_for_publication(uuid,uuid[])',
  'record_statistics_publication_effect(uuid,text,text,bigint,uuid[])',
  'record_statistics_legend_meta_publication_effect(uuid,text,text,bigint)',
]

const compatibilityObjects = [...compatibilityViews, ...compatibilityFunctions]

const droppedNamePattern = `refresh_operations\\.(${compatibilityObjects.map((name) => name.split('(')[0]).join('|')})\\y`

const tablesWorkersUse = [
  'refresh_operations.operations',
  'accounts.proof_effects',
  'players.primary_monitoring_reconciliation',
  'rankings.leaderboard_effects',
  'rankings.leaderboard_deep_crawl_progress',
  'rankings.leaderboard_deep_crawl_mode_progress',
  'statistics.statistics_collection_effects',
  'statistics.statistics_collection_seals',
  'statistics.statistics_publication_effects',
  'statistics.statistics_legend_meta_publication_effects',
]

const serverUrl = process.env.DATABASE_URL
const describeWithDatabase = serverUrl ? describe : describe.skip

const databaseName = `effect_move_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const runtimeRole = `effect_runtime_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const deadLetterRole = 'brawltome_dead_letter'

const deadLetterTables = [
  'proof_effects',
  'leaderboard_effects',
  'statistics_collection_effects',
  'statistics_publication_effects',
  'statistics_legend_meta_publication_effects',
  'statistics_collection_seals',
]

let databaseUrl: string
let owner: postgres.Sql
let admin: postgres.Sql
let compatibilityObjectsBeforeTheDrop: string[]

const watermark = new Date('2026-08-10T00:00:00.000Z')

const leaderboardOperationId = randomUUID()
const leaderboardOperationKey = `leaderboard:${leaderboardOperationId}`
const leaderboardKind = 'leaderboard-1v1'
const leaderboardPayload = { mode: '1v1', pageDepth: 1, intervalMs: 60_000 }

const crawlWindow = new Date('2026-08-11T00:00:00.000Z')

const leaseOwner = 'effect-move-worker'
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

// orderedMigrations lists each migration after what it depends on, so one pass also finds everything built on these
function migrationsWithout(identities: ReadonlySet<string>): Migration[] {
  const skipped = new Set(identities)

  return orderedMigrations.filter((migration) => {
    const dependencies = [migration.predecessor, ...(migration.requires ?? [])]
    const isSkipped = skipped.has(migration.identity) || dependencies.some((identity) => skipped.has(identity ?? ''))

    if (isSkipped) skipped.add(migration.identity)

    return !isSkipped
  })
}

type LeasedOperation = {
  id: string
  kind: string
  operationKey: string
  payload: Record<string, unknown>
  status?: string
  workClass?: string
}

async function insertOperation(operation: LeasedOperation): Promise<void> {
  const status = operation.status ?? 'leased'

  await owner`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
       status, attempt_count, max_attempts, lease_token, lease_owner, lease_expires_at, completed_at)
    VALUES (${operation.id}, ${operation.id}, ${operation.kind}, ${`dedupe:${operation.id}`}, ${operation.operationKey},
            ${operation.workClass ?? 'maintenance'}, ${owner.json(operation.payload as never)},
            ${owner.json({ source: 'effect-tables-move-test', requestedBy: 'test' })},
            ${status}, 1, 3, 1, ${status === 'leased' ? leaseOwner : null},
            ${status === 'leased' ? new Date(Date.now() + 3_600_000) : null},
            ${status === 'succeeded' || status === 'dead_letter' ? new Date() : null})
  `
}

// table grants follow a table through SET SCHEMA, so these are the grants the role holds at the new names
async function grantDeadLetterAccessBeforeTheMove(): Promise<void> {
  await owner.unsafe(`GRANT USAGE ON SCHEMA refresh_operations TO ${deadLetterRole}`)

  for (const table of deadLetterTables) {
    await owner.unsafe(`GRANT SELECT ON refresh_operations.${table} TO ${deadLetterRole}`)
  }
}

async function findCompatibilityObjects(sql: postgres.Sql): Promise<string[]> {
  const found: string[] = []

  for (const view of compatibilityViews) {
    const [{ name }] = await sql<{ name: string | null }[]>`
      SELECT to_regclass(${`refresh_operations.${view}`})::text AS name
    `

    if (name) found.push(view)
  }

  for (const signature of compatibilityFunctions) {
    const [{ name }] = await sql<{ name: string | null }[]>`
      SELECT to_regprocedure(${`refresh_operations.${signature}`})::text AS name
    `

    if (name) found.push(signature)
  }

  return found
}

async function asRole(role: string, run: (transaction: postgres.Sql) => Promise<void>): Promise<void> {
  await owner.begin(async (transactionHandle) => {
    const transaction = transactionHandle as unknown as postgres.Sql

    await transaction.unsafe(`SET LOCAL ROLE "${role}"`)
    await run(transaction)
  })
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

  await migratePostgres(databaseUrl, migrationsWithout(movingIdentities))

  await seedRowsBeforeTheMove()
  await grantDeadLetterAccessBeforeTheMove()

  // the schema the release still serving during the drop runs against
  await migratePostgres(databaseUrl, migrationsWithout(droppingIdentities))
  compatibilityObjectsBeforeTheDrop = await findCompatibilityObjects(owner)

  await migratePostgres(databaseUrl, orderedMigrations)
}, 60_000)

afterAll(async () => {
  if (!serverUrl) return

  await owner?.end()
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin?.unsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`)
  await admin?.unsafe(`DROP ROLE IF EXISTS ${deadLetterRole}`).catch(() => undefined)
  await admin?.end()
}, 30_000)

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

describeWithDatabase('queue effect tables at their owners', () => {
  test('a fresh database ends up identical to one migrated from before the moves', async () => {
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

  test('the views and wrappers existed until the drop and are gone after it', async () => {
    expect(compatibilityObjectsBeforeTheDrop).toEqual(compatibilityObjects)
    expect(await findCompatibilityObjects(owner)).toEqual([])
  })

  // plpgsql bodies are stored as text, so postgres would let these drops through and fail when the body next ran
  test('no surviving view or function body names a dropped object', async () => {
    const [control] = await owner<{ matches: boolean }[]>`
      SELECT 'FROM refresh_operations.proof_effects WHERE' ~ ${droppedNamePattern} AS matches
    `

    expect(control.matches).toBe(true)

    const references = await owner<{ name: string }[]>`
      SELECT n.nspname || '.' || p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~ ${droppedNamePattern}
      UNION ALL
      SELECT schemaname || '.' || viewname
      FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND definition ~ ${droppedNamePattern}
    `

    expect([...references]).toEqual([])
  })

  test('every drop sets a short lock timeout', () => {
    const drops = orderedMigrations.filter(({ identity }) => droppingIdentities.has(identity))

    expect(drops.map(({ identity }) => identity).sort()).toEqual([...droppingIdentities].sort())

    for (const migration of drops) {
      expect(migration.sql.startsWith("SET LOCAL lock_timeout = '5s';")).toBe(true)
    }
  })

  test('the drops finish while the tables workers use are locked access exclusive', async () => {
    const lockDatabaseName = `effect_drop_locks_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

    await admin.unsafe(`CREATE DATABASE "${lockDatabaseName}"`)

    const lockUrl = urlForDatabase(lockDatabaseName)

    await migratePostgres(lockUrl, migrationsWithout(droppingIdentities))

    const holder = postgres(lockUrl, { max: 1 })

    try {
      let release: () => void = () => undefined
      let markLocked: () => void = () => undefined

      const released = new Promise<void>((resolve) => {
        release = resolve
      })

      const locked = new Promise<void>((resolve) => {
        markLocked = resolve
      })

      const holding = holder.begin(async (transaction) => {
        await transaction.unsafe(`LOCK TABLE ${tablesWorkersUse.join(', ')} IN ACCESS EXCLUSIVE MODE`)
        markLocked()
        await released
      })

      await Promise.race([locked, holding])

      try {
        expect(await migratePostgres(lockUrl, orderedMigrations)).toBe(droppingIdentities.size)
      } finally {
        release()
      }

      await holding
    } finally {
      await holder.end()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${lockDatabaseName}" WITH (FORCE)`)
    }
  }, 60_000)

  test('the dead-letter role can read every effect table at the new names', async () => {
    await asRole(deadLetterRole, async (transaction) => {
      await transaction`SELECT count(*) FROM accounts.proof_effects`
      await transaction`SELECT count(*) FROM rankings.leaderboard_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_collection_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_publication_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_legend_meta_publication_effects`
      await transaction`SELECT count(*) FROM statistics.statistics_collection_seals`
    })
  })

  test('the dead-letter role cannot write those tables or read anything else in their schemas', async () => {
    await expect(
      asRole(deadLetterRole, async (transaction) => {
        await transaction`DELETE FROM accounts.proof_effects`
      }),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      asRole(deadLetterRole, async (transaction) => {
        await transaction`SELECT count(*) FROM statistics.cohorts`
      }),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      asRole(deadLetterRole, async (transaction) => {
        await transaction`SELECT count(*) FROM accounts.users`
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })

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

    test('the foreign key to operations still holds at the new name', async () => {
      await expect(
        owner`
          INSERT INTO statistics.statistics_collection_seals (collection_operation_id, publication_operation_id)
          VALUES (${randomUUID()}, ${publicationOperationId})
        `.execute(),
      ).rejects.toMatchObject({ code: '23503' })
    })

    test('the runtime role can use the tables and the record function at the new names', async () => {
      const collectionId = randomUUID()
      const collectionKey = `runtime-collection:${collectionId}`

      await insertOperation({
        id: collectionId,
        kind: collectionKind,
        operationKey: collectionKey,
        payload: collectionPayload,
        workClass: 'global-statistics',
      })

      await asRole(runtimeRole, async (transaction) => {
        const [effect] = await transaction<{ result: string }[]>`
          SELECT statistics.record_statistics_collection_effect(
            ${collectionId}, ${collectionKey}, ${collectionKind}, ${leaseOwner}, ${1}
          ) AS result
        `

        expect(effect.result).toBe('applied')

        await transaction`SELECT operation_id FROM statistics.statistics_collection_effects WHERE operation_id = ${collectionId}`
        await transaction`SELECT collection_operation_id FROM statistics.statistics_collection_seals`
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

    test('the runtime role can use the tables and the record function at the new names', async () => {
      const operationId = randomUUID()
      const operationKey = `runtime-leaderboard:${operationId}`

      await insertOperation({
        id: operationId,
        kind: leaderboardKind,
        operationKey,
        payload: leaderboardPayload,
        workClass: 'leaderboard',
      })

      await asRole(runtimeRole, async (transaction) => {
        const [effect] = await transaction<{ result: string }[]>`
          SELECT rankings.record_leaderboard_effect(
            ${operationId}, ${operationKey}, ${leaderboardKind}, ${leaseOwner}, ${1}
          ) AS result
        `

        expect(effect.result).toBe('applied')

        await transaction`
          INSERT INTO rankings.leaderboard_deep_crawl_progress (region, window_at, next_page, total_pages)
          VALUES ('BRZ', ${crawlWindow}, 2, 7)
        `

        await transaction`SELECT next_page FROM rankings.leaderboard_deep_crawl_progress WHERE region = 'BRZ'`
      })
    })
  })

  describe('accounts.proof_effects', () => {
    test('owner schema holds the row seeded before the move', async () => {
      const rows = await owner<{ operation_id: string; effect_value: unknown }[]>`
        SELECT operation_id, effect_value FROM accounts.proof_effects WHERE operation_key = ${`seeded:${proofOperationKey}`}
      `

      expect([...rows]).toEqual([{ operation_id: proofOperationId, effect_value: proofPayload }])
    })

    test('the foreign key to operations still holds at the new name', async () => {
      await expect(
        owner`
          INSERT INTO accounts.proof_effects (operation_key, operation_id, lease_token, effect_value)
          VALUES (${`orphan:${randomUUID()}`}, ${randomUUID()}, 1, ${owner.json(proofPayload)})
        `.execute(),
      ).rejects.toMatchObject({ code: '23503' })
    })

    test('the runtime role can read and write the new name', async () => {
      const operationKey = `runtime:${randomUUID()}`
      const operationId = randomUUID()

      await insertOperation({ id: operationId, kind: 'proof', operationKey, payload: proofPayload })

      await asRole(runtimeRole, async (transaction) => {
        await transaction`
          INSERT INTO accounts.proof_effects (operation_key, operation_id, lease_token, effect_value)
          VALUES (${operationKey}, ${operationId}, ${1}, ${transaction.json(proofPayload)})
        `

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

    test('the runtime role can read and write the new name', async () => {
      const newer = new Date(watermark.getTime() + 2_000)

      await asRole(runtimeRole, async (transaction) => {
        await transaction`SELECT observed_at FROM players.primary_monitoring_reconciliation WHERE singleton FOR UPDATE`

        await transaction`
          INSERT INTO players.primary_monitoring_reconciliation (singleton, observed_at)
          VALUES (true, ${newer})
          ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
        `
      })
    })
  })
})
