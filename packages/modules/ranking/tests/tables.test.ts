import { afterAll, beforeAll, describe, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import { leaderboardEffects } from '../db/leaderboard-effects'
import { rankingModule } from '../index'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'ranking_tables', modules: [refreshOperationsModule, rankingModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('ranking drizzle tables', () => {
  test('leaderboard effects match the migrated database', async () => {
    await expectTablesMatchDatabase(database, [leaderboardEffects])
  })
})
