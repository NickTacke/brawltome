import { afterAll, describe, expect, test } from 'bun:test'
import { eq, sql as rawSql } from 'drizzle-orm'
import { date, jsonb as drizzleJsonb, integer, pgTable, timestamp } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { json, jsonb } from '../columns'
import { createDatabase, type Database } from '../database'

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

  test('keeps postgres.js parsing on the sql client that modules share with drizzle', async () => {
    const database = open({ maxConnections: 1, applicationName: 'foundation-test' })
    const at = new Date('2026-11-04T12:00:00.000Z')

    const [row] = await database.sql<{ at: Date; document: { value: number } }[]>`
      select ${at}::timestamptz as at, ${database.sql.json({ value: 1 })}::jsonb as document
    `

    expect(row?.at).toEqual(at)
    expect(row?.document).toEqual({ value: 1 })
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

type Document = { name: string; tags: string[]; score: number }

const document: Document = { name: 'scratch', tags: ['a', 'b'], score: 3 }

// one connection, so the temporary table is there for every query the test runs
async function openScratch(columnsSql: string): Promise<Database> {
  const database = open({ maxConnections: 1, applicationName: 'foundation-test' })

  await database.sql.unsafe(`create temporary table scratch (id integer primary key, ${columnsSql})`)

  return database
}

async function inTimeZone(timeZone: string, run: () => Promise<void>): Promise<void> {
  const previousTimeZone = process.env.TZ

  process.env.TZ = timeZone

  try {
    await run()
  } finally {
    process.env.TZ = previousTimeZone
  }
}

describeWithDatabase('drizzle columns on the shared client', () => {
  test('jsonb stores the value as json, not as a json string', async () => {
    const database = await openScratch('document jsonb not null')
    const scratch = pgTable('scratch', { id: integer('id').primaryKey(), document: jsonb<Document>('document') })

    await database.db.insert(scratch).values({ id: 1, document })
    const [stored] = await database.sql`select jsonb_typeof(document) as type, document->>'name' as name from scratch`
    const [row] = await database.db.select().from(scratch).where(eq(scratch.id, 1))

    expect(stored).toEqual({ type: 'object', name: 'scratch' })
    expect(row?.document).toEqual(document)
  })

  // postgres.js infers a parameter type for booleans, Dates, bytes and bigints, so these are the values to watch
  const topLevelValues: [string, unknown][] = [
    ['boolean', false],
    ['array', [true, 1]],
    ['string', 'text'],
    ['number', 3],
    ['object', { name: 'scratch' }],
    ['array', [1, 2]],
  ]

  test.each(['jsonb', 'json'])('%s keeps every kind of json value at the top level', async (columnType) => {
    const database = await openScratch(`document ${columnType} not null`)
    const column = columnType === 'jsonb' ? jsonb<unknown>('document') : json<unknown>('document')
    const scratch = pgTable('scratch', { id: integer('id').primaryKey(), document: column })
    const values = topLevelValues.map(([, document], index) => ({ id: index + 1, document }))

    await database.db.insert(scratch).values(values)
    const stored = await database.sql.unsafe(`select ${columnType}_typeof(document) as type from scratch order by id`)
    const rows = await database.db.select().from(scratch).orderBy(scratch.id)

    expect(stored.map((row) => row.type)).toEqual(topLevelValues.map(([type]) => type))
    expect(rows.map((row) => row.document)).toEqual(topLevelValues.map(([, document]) => document))
  })

  test('json stores the value as json, not as a json string', async () => {
    const database = await openScratch('document json not null')
    const scratch = pgTable('scratch', { id: integer('id').primaryKey(), document: json<Document>('document') })

    await database.db.insert(scratch).values({ id: 1, document })
    const [stored] = await database.sql`select json_typeof(document) as type, document->>'name' as name from scratch`
    const [row] = await database.db.select().from(scratch).where(eq(scratch.id, 1))

    expect(stored).toEqual({ type: 'object', name: 'scratch' })
    expect(row?.document).toEqual(document)
  })

  // why modules take jsonb and json from foundation: drizzle's own column encodes once and postgres.js again
  test("drizzle's own jsonb column stores a json string", async () => {
    const database = await openScratch('document jsonb not null')
    const scratch = pgTable('scratch', { id: integer('id').primaryKey(), document: drizzleJsonb('document') })

    await database.db.insert(scratch).values({ id: 1, document })
    const [stored] = await database.sql`select jsonb_typeof(document) as type from scratch`

    expect(stored?.type).toBe('string')
  })

  test('timestamptz round-trips the same instant in any process time zone', async () => {
    const database = await openScratch('at timestamptz not null')

    const scratch = pgTable('scratch', {
      id: integer('id').primaryKey(),
      at: timestamp('at', { withTimezone: true }).notNull(),
    })

    const at = new Date('2026-11-04T12:34:56.789Z')

    await inTimeZone('Europe/Amsterdam', async () => {
      await database.db.insert(scratch).values({ id: 1, at })
      const [stored] = await database.sql`select extract(epoch from at) * 1000 as epoch_ms from scratch`
      const [row] = await database.db.select().from(scratch).where(eq(scratch.id, 1))

      expect(Number(stored?.epoch_ms)).toBe(at.getTime())
      expect(row?.at.getTime()).toBe(at.getTime())
    })
  })

  test.each(['Europe/Amsterdam', 'America/Los_Angeles'])('date round-trips the same day in %s', async (timeZone) => {
    const database = await openScratch('day date not null')
    const scratch = pgTable('scratch', { id: integer('id').primaryKey(), day: date('day').notNull() })

    await inTimeZone(timeZone, async () => {
      await database.db.insert(scratch).values({ id: 1, day: '2026-11-04' })
      const [stored] = await database.sql`select day::text as day from scratch`
      const [row] = await database.db.select().from(scratch).where(eq(scratch.id, 1))

      expect(stored?.day).toBe('2026-11-04')
      expect(row?.day).toBe('2026-11-04')
    })
  })
})
