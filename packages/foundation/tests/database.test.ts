import { afterAll, describe, expect, test } from 'bun:test'
import { sql as rawSql } from 'drizzle-orm'
import postgres from 'postgres'
import { type Database, createDatabase } from '../database'

const connectionString = process.env.DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const openDatabases: Database[] = []

function open(options: Parameters<typeof createDatabase>[1]): Database {
  const database = createDatabase(connectionString ?? '', options)
  openDatabases.push(database)

  return database
}

// what a plain client gets from the role, database and URL, whatever the test server is configured with
async function readDefaultStatementTimeout(): Promise<string | undefined> {
  const plain = postgres(connectionString ?? '', { max: 1 })

  try {
    const [row] = await plain`select current_setting('statement_timeout') as timeout`

    return row?.timeout
  } finally {
    await plain.end({ timeout: 5 })
  }
}

afterAll(async () => {
  await Promise.all(openDatabases.map((database) => database.close()))
})

describeWithDatabase('createDatabase', () => {
  test('runs queries through both the sql client and drizzle', async () => {
    const database = open({ maxConnections: 1, applicationName: 'foundation-test' })

    const [fromSql] = await database.sql`select 1 as value`
    const fromDrizzle = await database.db.execute(rawSql`select 1 as value`)

    expect(fromSql?.value).toBe(1)
    expect(fromDrizzle[0]?.value).toBe(1)
  })

  test('sets the application name', async () => {
    const database = open({ maxConnections: 1, applicationName: 'foundation-test-name' })

    const [row] = await database.sql`select current_setting('application_name') as name`

    expect(row?.name).toBe('foundation-test-name')
  })

  test('applies the statement timeout when given', async () => {
    const database = open({ maxConnections: 1, applicationName: 'foundation-test', statementTimeoutMs: 1_500 })

    const [row] = await database.sql`select current_setting('statement_timeout') as timeout`

    expect(row?.timeout).toBe('1500ms')
  })

  test('leaves the statement timeout alone when not given', async () => {
    const database = open({ maxConnections: 1, applicationName: 'foundation-test' })
    const serverDefault = await readDefaultStatementTimeout()

    const [row] = await database.sql`select current_setting('statement_timeout') as timeout`

    expect(row?.timeout).toBe(serverDefault)
  })

  test('close resolves', async () => {
    // opened through the helper so afterAll still ends the client if an assertion fails first
    const database = open({ maxConnections: 1, applicationName: 'foundation-test' })
    await database.sql`select 1`

    await expect(database.close()).resolves.toBeUndefined()
  })
})
