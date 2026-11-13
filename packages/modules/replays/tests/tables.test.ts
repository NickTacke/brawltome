import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as replaysTables from '../db/tables'
import { replaysModule } from '../index'

const tables = Object.values(replaysTables).flatMap((value) => (is(value, PgTable) ? [value] : []))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'replays_tables', modules: [...accountsTestModules, replaysModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('replays drizzle tables', () => {
  test('match the migrated database', async () => {
    await expectTablesMatchDatabase(database, tables)
  })

  test('cover every replays table', async () => {
    const rows = await database.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'replays' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const modelledTables = tables.map((table) => getTableConfig(table).name).sort()

    expect(modelledTables).toEqual(rows.map(({ name }) => name))
  })
})
