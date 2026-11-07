import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { type Database, createDatabase } from './database'
import type { Migration } from './migration'
import { orderMigrations } from './migrations/order'
import { migratePostgres } from './migrations/postgres'
import { type BrawltomeModule, checkModuleList } from './module'

export type CreateTestDatabaseOptions = {
  // names the test in the database name and in errors, e.g. player_ranked
  label: string
  modules: readonly BrawltomeModule[]
}

// a Database, so tests hand it straight to the module factories; close() ends the client, drop() also removes it
export type TestDatabase = Database & {
  connectionString: string
  drop(): Promise<void>
}

const maxNameBytes = 63
const clientConnections = 5
// lets tests that count connections in pg_stat_activity leave out their own
const testApplicationName = 'brawltome-test'

/** Creates a fresh database on the DATABASE_URL server and migrates the given modules into it. */
export async function createTestDatabase({ label, modules }: CreateTestDatabaseOptions): Promise<TestDatabase> {
  const databaseName = testDatabaseName(label)

  const serverUrl = process.env.DATABASE_URL

  if (!serverUrl) {
    throw new Error(`DATABASE_URL is required for Postgres tests (${label})`)
  }

  checkModuleList(modules)
  const migrations = orderMigrations(modules.flatMap((module) => module.migrations))

  // the name is checked against [a-z0-9_] above, so quoting it is enough
  await runAsAdmin(serverUrl, `CREATE DATABASE "${databaseName}"`)
  const dropDatabase = () => runAsAdmin(serverUrl, `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  const connectionString = withDatabaseName(serverUrl, databaseName)

  await migrateOrDrop(connectionString, migrations, dropDatabase)

  const database = openTestClient(connectionString)

  return {
    ...database,
    connectionString,
    drop: () => closeAndDrop(database, dropDatabase, databaseName),
  }
}

// another client on a test database, like the one a separate or restarted process opens; the caller closes it
export function openTestClient(connectionString: string): Database {
  return createDatabase(connectionString, { maxConnections: clientConnections, applicationName: testApplicationName })
}

// the database goes even when closing the client fails, and neither failure is lost
async function closeAndDrop(
  database: Database,
  dropDatabase: () => Promise<void>,
  databaseName: string,
): Promise<void> {
  const closeError = await failureOf(() => database.close())
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
  migrations: readonly Migration[],
  dropDatabase: () => Promise<void>,
): Promise<void> {
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
