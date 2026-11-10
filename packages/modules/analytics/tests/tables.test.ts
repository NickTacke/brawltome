import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as analyticsTables from '../db/tables'
import { analyticsModule } from '../index'

const tables = Object.values(analyticsTables).flatMap((value) => (is(value, PgTable) ? [value] : []))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'analytics_tables', modules: [analyticsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('analytics drizzle tables', () => {
  test('match the migrated database', async () => {
    await expectTablesMatchDatabase(database, tables)
  })

  test('cover every analytics table', async () => {
    const rows = await database.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'analytics' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const modelledTables = tables.map((table) => getTableConfig(table).name).sort()

    expect(modelledTables).toEqual(rows.map(({ name }) => name))
  })

  // an unlogged table is left out of the write-ahead log, which is where a logged secret would outlive its day
  test('keep the daily salts out of the write-ahead log', async () => {
    const [table] = await database.sql<{ persistence: string }[]>`
      SELECT relation.relpersistence AS persistence
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'analytics' AND relation.relname = 'daily_salts'
    `

    expect(table?.persistence).toBe('u')
  })

  // by default a table this small is only vacuumed after fifty dead rows, which is fifty days of deleted salts
  test('vacuum the daily salts after every delete', async () => {
    const [table] = await database.sql<{ options: string[] | null }[]>`
      SELECT relation.reloptions AS options
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'analytics' AND relation.relname = 'daily_salts'
    `

    expect(table?.options).toEqual(['autovacuum_vacuum_threshold=0', 'autovacuum_vacuum_scale_factor=0'])
  })
})
