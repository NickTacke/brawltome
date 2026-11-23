import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as esportsTables from '../db/tables'
import { esportsModule } from '../index'

const tables = Object.values(esportsTables).flatMap((value) => (is(value, PgTable) ? [value] : []))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'esports_tables', modules: [queueModule, playerModule, esportsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('esports drizzle tables', () => {
  test('match the migrated database', async () => {
    await expectTablesMatchDatabase(database, tables)
  })

  test('cover every esports table', async () => {
    const rows = await database.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'esports' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const modelledTables = tables.map((table) => getTableConfig(table).name).sort()

    expect(modelledTables).toEqual(rows.map(({ name }) => name))
  })
})
