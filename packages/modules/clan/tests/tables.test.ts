import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/queue'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as clanTables from '../db/tables'
import { clanModule } from '../index'

// the v2 import evidence stays in the database for audits, but no clan code reads or writes it
const unmodelledTables = [
  'import_conflicts',
  'legacy_archive',
  'legacy_import_ledger',
  'legacy_import_progress',
  'legacy_import_rejections',
]

const tables = Object.values(clanTables).flatMap((value) => (is(value, PgTable) ? [value] : []))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_tables', modules: [refreshOperationsModule, clanModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('clan drizzle tables', () => {
  test('match the migrated database', async () => {
    await expectTablesMatchDatabase(database, tables)
  })

  test('cover every clans table the code uses', async () => {
    const rows = await database.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'clans' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const usedTables = rows.map(({ name }) => name).filter((name) => !unmodelledTables.includes(name))
    const modelledTables = tables.map((table) => getTableConfig(table).name).sort()

    expect(modelledTables).toEqual(usedTables)
  })
})
