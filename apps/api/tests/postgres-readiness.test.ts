import { describe, expect, test } from 'bun:test'
import type { Sql } from '@brawltome/foundation'
import { createPostgresReadiness, readinessTimeoutMs } from '../src/postgres-readiness'

const migration = { identity: 'refresh-operations/0001', checksum: 'a'.repeat(64) }

// stands in for a pool whose connections are all busy: the query is queued and never answered
function queuedForever(): Sql {
  return (() => new Promise(() => {})) as unknown as Sql
}

function answering(rows: unknown[]): Sql {
  return (async () => rows) as unknown as Sql
}

describe('postgres readiness', () => {
  test('answers well inside the Docker health check timeout of 3 s', () => {
    expect(readinessTimeoutMs).toBeLessThan(3_000)
  })

  test('fails as not ready when the database does not answer in time', async () => {
    const readiness = createPostgresReadiness(queuedForever(), [migration], { timeoutMs: 20 })
    const startedAt = performance.now()

    await expect(readiness.check()).rejects.toThrow(
      'postgres readiness: the database did not answer within 20 ms (pool busy or database unreachable)',
    )
    expect(performance.now() - startedAt).toBeLessThan(500)
  })

  test('passes when the known migrations are applied', async () => {
    const readiness = createPostgresReadiness(answering([migration]), [migration], { timeoutMs: 20 })

    await expect(readiness.check()).resolves.toBeUndefined()
  })

  test('still reports a missing migration rather than a timeout', async () => {
    const readiness = createPostgresReadiness(answering([]), [migration], { timeoutMs: 20 })

    await expect(readiness.check()).rejects.toThrow('schema migration refresh-operations/0001 is not applied')
  })
})
