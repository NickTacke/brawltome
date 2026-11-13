import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import postgres from 'postgres'
import { replayAnalysisModule } from '../index'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('replay-analysis migrations', () => {
  let database: TestDatabase | undefined
  let control: postgres.Sql | undefined

  beforeAll(async () => {
    database = await createTestDatabase({
      label: 'replay_analysis_migrations',
      modules: [...accountsTestModules, replayAnalysisModule],
    })

    control = postgres(database.connectionString, { max: 1 })
  }, 20_000)

  afterAll(async () => {
    await control?.end()
    await database?.drop()
  }, 20_000)

  test('the prototype schema is gone after migrating', async () => {
    const [row] = await (control as postgres.Sql)`SELECT to_regnamespace('replay_analysis') AS schema`

    expect(row?.schema).toBeNull()
  })
})
