import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as refreshOperationsTables from '../db/tables'
import { refreshOperationsModule } from '../index'

// a queue-only test database keeps these here; only the owners' migrations move them
const movedToOwnerModules = ['primary_monitoring_reconciliation']

const tables = Object.values(refreshOperationsTables).flatMap((value) => (is(value, PgTable) ? [value] : []))

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_tables', modules: [refreshOperationsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('refresh operations drizzle tables', () => {
  test('match the migrated database', async () => {
    await expectTablesMatchDatabase(database, tables)
  })

  test('cover every refresh_operations table', async () => {
    const rows = await database.sql<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'refresh_operations' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `

    const databaseTables = rows.map(({ name }) => name).filter((name) => !movedToOwnerModules.includes(name))
    const modelledTables = tables.map((table) => getTableConfig(table).name).sort()

    expect(modelledTables).toEqual(databaseTables)
  })
})
