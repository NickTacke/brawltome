import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import type { Database } from '../database'
import type { Migration } from '../migration'
import { checksumSql } from '../migrations/plan'
import type { BrawltomeModule } from '../module'
import { type TestDatabase, createTestDatabase } from '../testing'

const connectionString = process.env.DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const createdDatabases: TestDatabase[] = []

function migration(identity: string, predecessor: string | null, sql: string): Migration {
  return { identity, predecessor, sql, checksum: checksumSql(sql) }
}

const playersModule: BrawltomeModule = {
  name: 'players',
  dependsOn: [],
  migrations: [migration('testing-players/0001', null, 'CREATE SCHEMA players; CREATE TABLE players.names (id int);')],
}

async function create(label: string, modules: readonly BrawltomeModule[]): Promise<TestDatabase> {
  const database = await createTestDatabase({ label, modules })
  createdDatabases.push(database)

  return database
}

function databaseNameOf(database: TestDatabase): string {
  return new URL(database.connectionString).pathname.slice(1)
}

async function existingDatabaseNames(pattern: string): Promise<string[]> {
  const admin = postgres(connectionString ?? '', { max: 1 })
  try {
    const rows = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${pattern}`
    return rows.map(({ datname }) => datname)
  } finally {
    await admin.end()
  }
}

// assigning undefined to process.env stores the string "undefined", so an unset value is deleted
function restoreDatabaseUrl(configured: string | undefined): void {
  if (configured === undefined) {
    Reflect.deleteProperty(process.env, 'DATABASE_URL')
    return
  }

  process.env.DATABASE_URL = configured
}

afterAll(async () => {
  await Promise.all(createdDatabases.map((database) => database.drop()))
})

describe('createTestDatabase without a database', () => {
  test('rejects a label with characters other than lowercase letters, digits and underscores', async () => {
    await expect(createTestDatabase({ label: 'Player-Ranked', modules: [] })).rejects.toThrow(
      'test database label Player-Ranked may only contain a-z, 0-9 and _',
    )
  })

  test('rejects a label that would make the database name longer than Postgres allows', async () => {
    const label = 'a'.repeat(60)

    await expect(createTestDatabase({ label, modules: [] })).rejects.toThrow(
      `test database label ${label} is too long for the 63-byte Postgres name limit`,
    )
  })

  test('names the test that needs DATABASE_URL when it is missing', async () => {
    const configured = process.env.DATABASE_URL
    Reflect.deleteProperty(process.env, 'DATABASE_URL')

    try {
      await expect(createTestDatabase({ label: 'missing_url', modules: [] })).rejects.toThrow(
        'DATABASE_URL is required for Postgres tests (missing_url)',
      )
    } finally {
      restoreDatabaseUrl(configured)
    }
  })
})

describeWithDatabase('createTestDatabase', () => {
  test('gives parallel helpers different databases that both hold the modules schema', async () => {
    const [first, second] = await Promise.all([create('helper', [playersModule]), create('helper', [playersModule])])

    expect(databaseNameOf(first)).toMatch(new RegExp(`^bt_helper_${process.pid}_[0-9a-f]{12}$`))
    expect(databaseNameOf(first)).not.toBe(databaseNameOf(second))
    for (const database of [first, second]) {
      const schemas = await database.sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'players'`
      expect(schemas).toHaveLength(1)
    }
  })

  test('records the applied migrations in the migration history', async () => {
    const database = await create('history', [playersModule])

    const rows = await database.sql<{ identity: string }[]>`SELECT identity FROM brawltome_migrations.history`

    expect(rows.map(({ identity }) => identity)).toEqual(['testing-players/0001'])
  })

  test('is a Database that factories can take: drizzle runs over the same labelled client', async () => {
    const database: Database = await create('as_database', [playersModule])

    const result = await database.db.execute<{ application_name: string }>(
      sql`SELECT current_setting('application_name') AS application_name`,
    )

    expect([...result]).toEqual([{ application_name: 'brawltome-test' }])
  })

  test('removes the database on drop', async () => {
    const database = await createTestDatabase({ label: 'dropped', modules: [playersModule] })
    const databaseName = databaseNameOf(database)

    await database.drop()

    expect(await existingDatabaseNames(databaseName)).toEqual([])
  })

  test('rejects a module list whose dependencies are missing', async () => {
    const statisticsModule: BrawltomeModule = { name: 'statistics', dependsOn: ['players'], migrations: [] }

    await expect(createTestDatabase({ label: 'missing_dependency', modules: [statisticsModule] })).rejects.toThrow(
      'module statistics depends on players, which is not loaded',
    )
  })

  test('leaves no database behind when the migrations cannot be ordered', async () => {
    const orphanModule: BrawltomeModule = {
      name: 'orphan',
      dependsOn: [],
      migrations: [migration('testing-orphan/0002', 'testing-orphan/0001', 'SELECT 1;')],
    }

    await expect(createTestDatabase({ label: 'unordered', modules: [orphanModule] })).rejects.toThrow(
      'missing predecessor testing-orphan/0001 for testing-orphan/0002',
    )
    expect(await existingDatabaseNames(`bt_unordered_${process.pid}_%`)).toEqual([])
  })

  test('drops the database again when a migration fails', async () => {
    const brokenModule: BrawltomeModule = {
      name: 'broken',
      dependsOn: [],
      migrations: [migration('testing-broken/0001', null, 'SELECT * FROM missing_table;')],
    }

    await expect(createTestDatabase({ label: 'broken', modules: [brokenModule] })).rejects.toThrow(
      /migrate test database bt_broken_\d+_[0-9a-f]{12}/,
    )
    expect(await existingDatabaseNames(`bt_broken_${process.pid}_%`)).toEqual([])
  })
})
