import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type Migration, migratePostgres } from '@brawltome/foundation'
import { playerRefreshSettledChannel } from '@brawltome/queue'
import postgres from 'postgres'
import { orderedMigrations } from '../src/inventories'

const renameIdentity = 'refresh-operations/0032'

// the ranking retention setting has the same dotted shape as a table name, but it is a session setting
const oldSchemaReference = /\brefresh_operations\.(?!ranking_retention_lease\b)/

const retentionSetting = 'refresh_operations.ranking_retention_lease'

const functionsNamingTheSchema = [
  'queue.acquire_active_lease(uuid,text,bigint)',
  'queue.commit_interactive_section_if_owned(uuid,text,bigint,text)',
  'queue.complete_ranking_retention_lease(uuid,text,bigint)',
  'queue.lock_active_leaderboard_lease(uuid,text,text,text,bigint)',
  'queue.lock_active_ranking_retention_lease(uuid,text,bigint)',
  'rankings.record_leaderboard_effect(uuid,text,text,text,bigint)',
  'statistics.record_statistics_collection_effect(uuid,text,text,text,bigint)',
  'statistics.record_statistics_legend_meta_publication_effect(uuid,text,text,bigint)',
  'statistics.record_statistics_publication_effect(uuid,text,text,bigint,uuid[])',
  'statistics.seal_statistics_collections_for_publication(uuid,uuid[])',
  'statistics.validate_collection_attempt_operation()',
  'statistics.validate_legend_meta_publication_decision()',
  'statistics.validate_legend_meta_publication_operation()',
  'statistics.validate_publication_decision_operation()',
  'statistics.validate_publication_operation()',
]

const functionBodiesSql = `
  SELECT p.oid::regprocedure::text AS name, p.prosrc AS definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
`

const storedDefinitionsSql = `
  SELECT 'trigger ' || t.tgname AS name, pg_catalog.pg_get_triggerdef(t.oid) AS definition
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'view ' || schemaname || '.' || viewname, definition
  FROM pg_catalog.pg_views
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT 'default ' || d.adrelid::regclass::text, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  FROM pg_catalog.pg_attrdef d
  UNION ALL
  SELECT 'constraint ' || c.conname, pg_catalog.pg_get_constraintdef(c.oid)
  FROM pg_catalog.pg_constraint c
  WHERE c.contype <> 'f'
  UNION ALL
  SELECT 'index ' || schemaname || '.' || indexname, indexdef
  FROM pg_catalog.pg_indexes
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
`

type StoredDefinition = { name: string; definition: string }

const serverUrl = process.env.DATABASE_URL
const describeWithDatabase = serverUrl ? describe : describe.skip

const databaseName = `queue_schema_rename_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
const operatorRole = `queue_rename_${randomUUID().replaceAll('-', '')}`.slice(0, 63)

const migrationsBeforeRename: Migration[] = orderedMigrations.filter(({ identity }) => identity !== renameIdentity)

function urlForDatabase(name: string): string {
  const url = new URL(serverUrl as string)

  url.pathname = `/${name}`

  return url.toString()
}

function namesOf(definitions: readonly StoredDefinition[]): string[] {
  return definitions.map(({ name }) => name)
}

function namingOldSchema(definitions: readonly StoredDefinition[]): string[] {
  return namesOf(definitions.filter(({ definition }) => oldSchemaReference.test(definition)))
}

describeWithDatabase('renaming the refresh_operations schema to queue', () => {
  let admin: ReturnType<typeof postgres>
  let client: ReturnType<typeof postgres>

  beforeAll(async () => {
    admin = postgres(urlForDatabase('postgres'), { max: 1, onnotice: () => undefined })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    await admin.unsafe(`CREATE ROLE "${operatorRole}" NOLOGIN`)

    await migratePostgres(urlForDatabase(databaseName), migrationsBeforeRename)

    client = postgres(urlForDatabase(databaseName), { max: 1, onnotice: () => undefined })

    await client.unsafe(`GRANT USAGE ON SCHEMA refresh_operations TO "${operatorRole}"`)
    await client.unsafe(`GRANT SELECT ON refresh_operations.operations TO "${operatorRole}"`)

    await migratePostgres(urlForDatabase(databaseName), orderedMigrations)
  }, 60_000)

  afterAll(async () => {
    await client?.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.unsafe(`DROP ROLE IF EXISTS "${operatorRole}"`)
    await admin.end()
  })

  test('the queue schema exists, refresh_operations does not, and every function body that named the old schema names the new one', async () => {
    const schemas = await client<{ name: string }[]>`
      SELECT nspname AS name FROM pg_catalog.pg_namespace
      WHERE nspname IN ('queue', 'refresh_operations')
    `

    const bodies = await client.unsafe<StoredDefinition[]>(functionBodiesSql)

    const namingNewSchema = bodies.filter(({ definition }) => /\bqueue\.[a-z_]+/.test(definition))

    expect(schemas.map(({ name }) => name)).toEqual(['queue'])
    expect(namingOldSchema(bodies)).toEqual([])
    expect(namesOf(namingNewSchema).sort()).toEqual(functionsNamingTheSchema)
  })

  test('no trigger, view, default, constraint or index names the old schema', async () => {
    const definitions = await client.unsafe<StoredDefinition[]>(storedDefinitionsSql)

    expect(definitions.length).toBeGreaterThan(0)
    expect(namingOldSchema(definitions)).toEqual([])
  })

  test('grants made on the old schema still apply', async () => {
    const [privileges] = await client<{ usage: boolean; select: boolean }[]>`
      SELECT
        has_schema_privilege(${operatorRole}, 'queue', 'USAGE') AS usage,
        has_table_privilege(${operatorRole}, 'queue.operations', 'SELECT') AS select
    `

    expect(privileges).toEqual({ usage: true, select: true })
  })

  test('the settled channel and the retention setting keep their names', async () => {
    const bodies = await client.unsafe<StoredDefinition[]>(functionBodiesSql)

    const definitionOf = (name: string) => bodies.find((body) => body.name === name)?.definition

    expect(playerRefreshSettledChannel).toBe('refresh_operations_player_refresh_settled')
    expect(definitionOf('queue.notify_player_refresh_settled()')).toContain(`'${playerRefreshSettledChannel}'`)

    expect(definitionOf('queue.lock_active_ranking_retention_lease(uuid,text,bigint)')).toContain(
      `'${retentionSetting}'`,
    )

    expect(definitionOf('queue.complete_ranking_retention_lease(uuid,text,bigint)')).toContain(`'${retentionSetting}'`)
  })

  test('runs after every other module migration that names the old schema', () => {
    const identities = orderedMigrations.map(({ identity }) => identity)
    const renamePosition = identities.indexOf(renameIdentity)

    const lastNamingOldSchema = ['accounts/0012', 'players/0022', 'rankings/0014', 'statistics/0006']

    expect(renamePosition).toBeGreaterThan(-1)

    for (const identity of lastNamingOldSchema) {
      expect(identities.indexOf(identity)).toBeLessThan(renamePosition)
    }
  })

  test('sets a short lock timeout', () => {
    const rename = orderedMigrations.find(({ identity }) => identity === renameIdentity)

    expect(rename?.sql.startsWith("SET LOCAL lock_timeout = '5s';")).toBe(true)
  })

  test('does not wait for a worker mid claim, and that worker then fails without changing anything', async () => {
    const lockDatabaseName = `queue_rename_locks_${process.pid}_${randomUUID().replaceAll('-', '')}`.slice(0, 63)
    const operationId = randomUUID()

    await admin.unsafe(`CREATE DATABASE "${lockDatabaseName}"`)

    const lockUrl = urlForDatabase(lockDatabaseName)

    await migratePostgres(lockUrl, migrationsBeforeRename)

    const worker = postgres(lockUrl, { max: 1, onnotice: () => undefined })

    try {
      await worker`
        INSERT INTO refresh_operations.operations
          (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
        VALUES (${operationId}, ${operationId}, 'proof', ${`dedupe:${operationId}`}, ${`rename:${operationId}`},
                'maintenance', ${worker.json({ value: 'seed' })}, ${worker.json({ source: 'rename-test' })}, 3)
      `

      let release: () => void = () => undefined
      let markClaiming: () => void = () => undefined

      const released = new Promise<void>((resolve) => {
        release = resolve
      })

      const claiming = new Promise<void>((resolve) => {
        markClaiming = resolve
      })

      const claim = worker.begin(async (transaction) => {
        await transaction`SELECT id FROM refresh_operations.operations WHERE id = ${operationId} FOR UPDATE`
        await transaction`UPDATE refresh_operations.operations SET attempt_count = 1 WHERE id = ${operationId}`
        markClaiming()
        await released
        await transaction`UPDATE refresh_operations.operations SET status = 'running' WHERE id = ${operationId}`
      })

      const claimOutcome = claim.then(
        () => 'committed',
        (error: Error) => error.message,
      )

      await Promise.race([claiming, claimOutcome])

      try {
        expect(await migratePostgres(lockUrl, orderedMigrations)).toBe(1)
      } finally {
        release()
      }

      expect(await claimOutcome).toContain('relation "refresh_operations.operations" does not exist')

      const [operation] = await worker<{ status: string; attempts: number }[]>`
        SELECT status, attempt_count AS attempts FROM queue.operations WHERE id = ${operationId}
      `

      expect(operation).toEqual({ status: 'pending', attempts: 0 })
    } finally {
      await worker.end()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${lockDatabaseName}" WITH (FORCE)`)
    }
  }, 60_000)
})
