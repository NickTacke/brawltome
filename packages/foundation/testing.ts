import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import type { Sql } from './database'
import { orderMigrations } from './migrations/order'
import { migratePostgres } from './migrations/postgres'
import { type BrawltomeModule, checkModuleList } from './module'

export type CreateTestDatabaseOptions = {
  // names the test in the database name and in errors, e.g. player_ranked
  label: string
  modules: readonly BrawltomeModule[]
}

export type TestDatabase = {
  connectionString: string
  sql: Sql
  drop(): Promise<void>
}

const maxNameBytes = 63
const clientConnections = 5

/** Creates a fresh database on the DATABASE_URL server and migrates the given modules into it. */
export async function createTestDatabase({ label, modules }: CreateTestDatabaseOptions): Promise<TestDatabase> {
  const databaseName = testDatabaseName(label)

  const serverUrl = process.env.DATABASE_URL
  if (!serverUrl) {
    throw new Error(`DATABASE_URL is required for Postgres tests (${label})`)
  }

  checkModuleList(modules)

  // the name is checked against [a-z0-9_] above, so quoting it is enough
  await runAsAdmin(serverUrl, `CREATE DATABASE "${databaseName}"`)
  const dropDatabase = () => runAsAdmin(serverUrl, `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  const connectionString = withDatabaseName(serverUrl, databaseName)
  await migrateOrDrop(connectionString, modules, dropDatabase)

  const sql = postgres(connectionString, { max: clientConnections })

  return {
    connectionString,
    sql,
    drop: () => closeAndDrop(sql, dropDatabase, databaseName),
  }
}

// the database goes even when closing the client fails, and neither failure is lost
async function closeAndDrop(sql: Sql, dropDatabase: () => Promise<void>, databaseName: string): Promise<void> {
  const closeError = await failureOf(() => sql.end())
  const dropError = await failureOf(dropDatabase)

  if (closeError !== undefined && dropError !== undefined) {
    throw new AggregateError(
      [closeError, dropError],
      `drop test database ${databaseName}: closing the client and dropping the database both failed`,
    )
  }

  if (dropError !== undefined) {
    throw dropError
  }

  if (closeError !== undefined) {
    throw closeError
  }
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error
  }
}

function testDatabaseName(label: string): string {
  if (!/^[a-z0-9_]+$/.test(label)) {
    throw new Error(`test database label ${label} may only contain a-z, 0-9 and _`)
  }

  const suffix = randomBytes(6).toString('hex')
  const databaseName = `bt_${label}_${process.pid}_${suffix}`
  if (Buffer.byteLength(databaseName) > maxNameBytes) {
    throw new Error(`test database label ${label} is too long for the ${maxNameBytes}-byte Postgres name limit`)
  }

  return databaseName
}

function withDatabaseName(serverUrl: string, databaseName: string): string {
  const url = new URL(serverUrl)
  url.pathname = `/${databaseName}`

  return url.toString()
}

// CREATE and DROP DATABASE can't run inside the database they touch, so they go through postgres
async function runAsAdmin(serverUrl: string, statement: string): Promise<void> {
  const admin = postgres(withDatabaseName(serverUrl, 'postgres'), { max: 1 })
  try {
    await admin.unsafe(statement)
  } finally {
    await admin.end()
  }
}

// a half-migrated database is useless to the test, so it goes rather than leaking
async function migrateOrDrop(
  connectionString: string,
  modules: readonly BrawltomeModule[],
  dropDatabase: () => Promise<void>,
): Promise<void> {
  const migrations = orderMigrations(modules.flatMap((module) => module.migrations))

  try {
    await migratePostgres(connectionString, migrations)
  } catch (error) {
    await dropDatabase()
    const databaseName = new URL(connectionString).pathname.slice(1)
    throw new Error(`migrate test database ${databaseName}: ${errorMessage(error)}`, { cause: error })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
