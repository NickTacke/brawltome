import { afterAll, beforeAll, describe, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/queue'
import { proofEffects } from '../db/proof-effects'
import { accountsModule } from '../index'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'accounts_tables', modules: [refreshOperationsModule, accountsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('accounts drizzle tables', () => {
  test('proof effects match the migrated database', async () => {
    await expectTablesMatchDatabase(database, [proofEffects])
  })
})
