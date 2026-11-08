import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import { createTestJobs } from './fixtures/queue'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'queue_job_list', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

function kindsAllowedBy(constraintDefinition: string): string[] {
  return [...constraintDefinition.matchAll(/'([a-z0-9-]+)'::text/g)].map(([, kind]) => kind).sort()
}

describe('queue job list', () => {
  test('every allowed kind has a job', async () => {
    const [constraint] = await database.sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'operations_kind_check'
        AND conrelid = 'refresh_operations.operations'::regclass
    `

    const allowedKinds = kindsAllowedBy(constraint.definition)

    expect(allowedKinds.length).toBeGreaterThan(0)

    expect(
      createTestJobs()
        .map((job) => job.kind)
        .sort(),
    ).toEqual(allowedKinds)
  })
})
