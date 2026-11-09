import { expect, test } from 'bun:test'
import type { Database } from '@brawltome/foundation'
import { type AdmissionConfig, createPostgresRefreshOperations } from '@brawltome/refresh-operations'

test('claim names the problem on a queue built without jobs', async () => {
  const database = { sql: {} } as unknown as Database
  const operations = createPostgresRefreshOperations({ database })

  await expect(operations.claim('worker-a', 1_000, {} as AdmissionConfig)).rejects.toThrow(
    'claim operation for worker worker-a: queue was built without jobs',
  )
})
