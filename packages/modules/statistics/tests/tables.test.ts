import { afterAll, beforeAll, describe, test } from 'bun:test'
import { createTestDatabase, expectTablesMatchDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import {
  statisticsCollectionEffects,
  statisticsCollectionSeals,
  statisticsLegendMetaPublicationEffects,
  statisticsPublicationEffects,
} from '../db/effects'
import { statisticsModule } from '../index'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'statistics_tables',
    modules: [queueModule, statisticsModule],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('statistics drizzle tables', () => {
  test('effect and seal tables match the migrated database', async () => {
    await expectTablesMatchDatabase(database, [
      statisticsCollectionEffects,
      statisticsCollectionSeals,
      statisticsLegendMetaPublicationEffects,
      statisticsPublicationEffects,
    ])
  })
})
