import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  doublePrecision,
  integer,
  numeric,
  type PgColumnBuilderBase,
  pgSchema,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { json, jsonb } from '../columns'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '../testing'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeWithDatabase = hasDatabase ? describe : describe.skip
const drift = pgSchema('drift')

let database: TestDatabase

beforeAll(async () => {
  if (!hasDatabase) return

  database = await createTestDatabase({ label: 'table_drift', modules: [] })

  await database.sql.unsafe(`
    CREATE SCHEMA drift;

    CREATE TABLE drift.members (
      id integer PRIMARY KEY,
      rank integer,
      name varchar(255) NOT NULL
    );

    CREATE TABLE drift.every_type (
      a_text text NOT NULL,
      a_integer integer NOT NULL,
      a_bigint bigint NOT NULL,
      a_smallint smallint NOT NULL,
      a_boolean boolean NOT NULL,
      a_numeric numeric NOT NULL,
      a_numeric_precision numeric(10) NOT NULL,
      a_numeric_scale numeric(10, 2) NOT NULL,
      a_char char(64) NOT NULL,
      a_char_default char NOT NULL,
      a_char_six char(6) NOT NULL,
      a_varchar varchar(255) NOT NULL,
      a_varchar_unbounded varchar NOT NULL,
      a_varchar_six varchar(6) NOT NULL,
      a_uuid uuid NOT NULL,
      a_jsonb jsonb NOT NULL,
      a_json json NOT NULL,
      a_timestamptz timestamptz NOT NULL,
      a_timestamptz_precision timestamptz(3) NOT NULL,
      a_timestamp timestamp NOT NULL,
      a_timestamp_six timestamp(6) NOT NULL,
      a_date date NOT NULL,
      a_double double precision NOT NULL,
      a_text_array text[] NOT NULL,
      a_integer_matrix integer[][] NOT NULL,
      a_varchar_array varchar(10)[] NOT NULL,
      a_numeric_array numeric(5, 1)[] NOT NULL,
      nullable_text text
    );

    CREATE TABLE drift.addresses (
      id integer PRIMARY KEY,
      address inet NOT NULL
    );

    CREATE TABLE public.in_public (id integer NOT NULL);
  `)
})

afterAll(async () => {
  if (hasDatabase) await database.drop()
})

const members = drift.table('members', {
  id: integer('id').primaryKey(),
  rank: integer('rank'),
  name: varchar('name', { length: 255 }).notNull(),
})

const everyType = drift.table('every_type', {
  aText: text('a_text').notNull(),
  aInteger: integer('a_integer').notNull(),
  aBigint: bigint('a_bigint', { mode: 'number' }).notNull(),
  aSmallint: smallint('a_smallint').notNull(),
  aBoolean: boolean('a_boolean').notNull(),
  aNumeric: numeric('a_numeric').notNull(),
  aNumericPrecision: numeric('a_numeric_precision', { precision: 10 }).notNull(),
  aNumericScale: numeric('a_numeric_scale', { precision: 10, scale: 2 }).notNull(),
  aChar: char('a_char', { length: 64 }).notNull(),
  aCharDefault: char('a_char_default').notNull(),
  aCharSix: char('a_char_six', { length: 6 }).notNull(),
  aVarchar: varchar('a_varchar', { length: 255 }).notNull(),
  aVarcharUnbounded: varchar('a_varchar_unbounded').notNull(),
  aVarcharSix: varchar('a_varchar_six', { length: 6 }).notNull(),
  aUuid: uuid('a_uuid').notNull(),
  aJsonb: jsonb<unknown>('a_jsonb').notNull(),
  aJson: json<unknown>('a_json').notNull(),
  aTimestamptz: timestamp('a_timestamptz', { withTimezone: true }).notNull(),
  aTimestamptzPrecision: timestamp('a_timestamptz_precision', { withTimezone: true, precision: 3 }).notNull(),
  aTimestamp: timestamp('a_timestamp').notNull(),
  aTimestampSix: timestamp('a_timestamp_six', { precision: 6 }).notNull(),
  aDate: date('a_date').notNull(),
  aDouble: doublePrecision('a_double').notNull(),
  aTextArray: text('a_text_array').array().notNull(),
  aIntegerMatrix: integer('a_integer_matrix').array().array().notNull(),
  aVarcharArray: varchar('a_varchar_array', { length: 10 }).array().notNull(),
  aNumericArray: numeric('a_numeric_array', { precision: 5, scale: 1 }).array().notNull(),
  nullableText: text('nullable_text'),
})

async function driftMessage(tables: Parameters<typeof expectTablesMatchDatabase>[1]): Promise<string> {
  try {
    await expectTablesMatchDatabase(database, tables)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  throw new Error('expected the tables to differ from the database, but they matched')
}

describeWithDatabase('expectTablesMatchDatabase', () => {
  test('passes when the tables match the database', async () => {
    await expectTablesMatchDatabase(database, [members])
  })

  test('passes for every column type the modules use', async () => {
    await expectTablesMatchDatabase(database, [everyType])
  })

  test('reads a table without a schema as public', async () => {
    const inPublic = pgTable('in_public', { id: integer('id').notNull() })

    await expectTablesMatchDatabase(database, [inPublic])
  })

  test('reports a column the database has and drizzle lacks', async () => {
    const table = drift.table('members', {
      id: integer('id').primaryKey(),
      name: varchar('name', { length: 255 }).notNull(),
    })

    expect(await driftMessage([table])).toContain('drift.members: column rank is in the database but not in drizzle')
  })

  test('reports a drizzle column the database lacks', async () => {
    const table = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: integer('rank'),
      name: varchar('name', { length: 255 }).notNull(),
      tag: text('tag'),
    })

    expect(await driftMessage([table])).toContain('drift.members: column tag is in drizzle but not in the database')
  })

  test('reports a type mismatch', async () => {
    const table = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: text('rank'),
      name: varchar('name', { length: 255 }).notNull(),
    })

    expect(await driftMessage([table])).toContain(
      'drift.members: column rank is integer in the database but text in drizzle',
    )
  })

  test('reports a column that is nullable in the database but not null in drizzle', async () => {
    const table = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: integer('rank').notNull(),
      name: varchar('name', { length: 255 }).notNull(),
    })

    expect(await driftMessage([table])).toContain(
      'drift.members: column rank is nullable in the database but not null in drizzle',
    )
  })

  test('reports a column that is not null in the database but nullable in drizzle', async () => {
    const table = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: integer('rank'),
      name: varchar('name', { length: 255 }),
    })

    expect(await driftMessage([table])).toContain(
      'drift.members: column name is not null in the database but nullable in drizzle',
    )
  })

  test('matches varchar(255) against character varying(255) but not a different length', async () => {
    const sameLength = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: integer('rank'),
      name: varchar('name', { length: 255 }).notNull(),
    })

    const otherLength = drift.table('members', {
      id: integer('id').primaryKey(),
      rank: integer('rank'),
      name: varchar('name', { length: 100 }).notNull(),
    })

    await expectTablesMatchDatabase(database, [sameLength])

    expect(await driftMessage([otherLength])).toContain(
      'drift.members: column name is character varying(255) in the database but character varying(100) in drizzle',
    )
  })

  test('reports a table the database lacks', async () => {
    const missing = drift.table('retired', { id: integer('id').notNull() })

    expect(await driftMessage([missing])).toContain('drift.retired: table is not in the database')
  })

  test('reports a table in the wrong schema', async () => {
    const wrongSchema = pgTable('members', { id: integer('id').primaryKey() })

    expect(await driftMessage([wrongSchema])).toContain('public.members: table is not in the database')
  })

  test('lists every difference in one error', async () => {
    const table = drift.table('members', {
      id: text('id').primaryKey(),
      name: varchar('name', { length: 255 }),
      tag: text('tag'),
    })

    const missing = drift.table('retired', { id: integer('id').notNull() })

    const message = await driftMessage([table, missing])

    expect(message).toContain('drift.members: column id is integer in the database but text in drizzle')
    expect(message).toContain('drift.members: column rank is in the database but not in drizzle')
    expect(message).toContain('drift.members: column name is not null in the database but nullable in drizzle')
    expect(message).toContain('drift.members: column tag is in drizzle but not in the database')
    expect(message).toContain('drift.retired: table is not in the database')
  })

  describe('compares types exactly', () => {
    const mismatches: [string, string, PgColumnBuilderBase, string][] = [
      [
        'numeric precision',
        'a_numeric_scale',
        numeric('a_numeric_scale', { precision: 12, scale: 2 }),
        'numeric(10,2) in the database but numeric(12,2)',
      ],
      [
        'numeric scale',
        'a_numeric_scale',
        numeric('a_numeric_scale', { precision: 10, scale: 3 }),
        'numeric(10,2) in the database but numeric(10,3)',
      ],
      [
        'numeric without precision',
        'a_numeric_scale',
        numeric('a_numeric_scale'),
        'numeric(10,2) in the database but numeric in drizzle',
      ],
      ['char length', 'a_char', char('a_char', { length: 32 }), 'character(64) in the database but character(32)'],
      [
        'char length of 6',
        'a_char_six',
        char('a_char_six', { length: 7 }),
        'character(6) in the database but character(7)',
      ],
      [
        'varchar length of 6',
        'a_varchar_six',
        varchar('a_varchar_six', { length: 7 }),
        'character varying(6) in the database but character varying(7)',
      ],
      [
        'timestamptz against timestamp',
        'a_timestamptz',
        timestamp('a_timestamptz'),
        'timestamp with time zone in the database but timestamp without time zone',
      ],
      [
        'timestamp against timestamptz',
        'a_timestamp',
        timestamp('a_timestamp', { withTimezone: true }),
        'timestamp without time zone in the database but timestamp with time zone',
      ],
      [
        'timestamp precision',
        'a_timestamptz_precision',
        timestamp('a_timestamptz_precision', { withTimezone: true }),
        'timestamp(3) with time zone in the database but timestamp with time zone',
      ],
      ['jsonb against json', 'a_jsonb', json<unknown>('a_jsonb'), 'jsonb in the database but json in drizzle'],
      ['uuid against text', 'a_uuid', text('a_uuid'), 'uuid in the database but text in drizzle'],
      ['bigint against integer', 'a_bigint', integer('a_bigint'), 'bigint in the database but integer in drizzle'],
      [
        'smallint against integer',
        'a_smallint',
        integer('a_smallint'),
        'smallint in the database but integer in drizzle',
      ],
      ['boolean against text', 'a_boolean', text('a_boolean'), 'boolean in the database but text in drizzle'],
      ['date against timestamp', 'a_date', timestamp('a_date'), 'date in the database but timestamp without time zone'],
      [
        'double precision against numeric',
        'a_double',
        numeric('a_double'),
        'double precision in the database but numeric in drizzle',
      ],
      ['array against scalar', 'a_text_array', text('a_text_array'), 'text[] in the database but text in drizzle'],
      ['scalar against array', 'a_text', text('a_text').array(), 'text in the database but text[] in drizzle'],
      [
        'array element type',
        'a_text_array',
        integer('a_text_array').array(),
        'text[] in the database but integer[] in drizzle',
      ],
      [
        'array element length',
        'a_varchar_array',
        varchar('a_varchar_array', { length: 20 }).array(),
        'character varying(10)[] in the database but character varying(20)[]',
      ],
      [
        'array element scale',
        'a_numeric_array',
        numeric('a_numeric_array', { precision: 5, scale: 2 }).array(),
        'numeric(5,1)[] in the database but numeric(5,2)[]',
      ],
    ]

    test.each(mismatches)('reports a %s mismatch', async (_label, columnName, column, expected) => {
      const table = drift.table('every_type', { [columnName]: column })

      const message = await driftMessage([table])

      expect(message).toContain(`drift.every_type: column ${columnName} is ${expected}`)
    })
  })

  describe('with a drizzle type the check does not know', () => {
    const inet = customType<{ data: string }>({ dataType: () => 'inet' })

    test('reports it even when the database column has the same type', async () => {
      const table = drift.table('addresses', { id: integer('id').primaryKey(), address: inet('address').notNull() })

      const message = await driftMessage([table])

      expect(message).toContain(
        'drift.addresses: column address has the drizzle type inet, which the table check does not know',
      )

      expect(message).not.toContain('in the database but')
    })

    test('still compares nullability on the same column', async () => {
      const table = drift.table('addresses', { id: integer('id').primaryKey(), address: inet('address') })

      const message = await driftMessage([table])

      expect(message).toContain(
        'drift.addresses: column address has the drizzle type inet, which the table check does not know',
      )

      expect(message).toContain('drift.addresses: column address is not null in the database but nullable in drizzle')
    })
  })
})
