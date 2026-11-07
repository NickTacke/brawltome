import { describe, expect, test } from 'bun:test'
import type { Sql } from '@brawltome/foundation'
import { createPostgresReadiness, readinessTimeoutMs } from '../src/postgres-readiness'

const migration = { identity: 'refresh-operations/0001', checksum: 'a'.repeat(64) }

type StubbedSql = { sql: Sql; cancelledQueries: () => number }

// a query like postgres.js returns: a promise that can be cancelled
function stubbedQuery<T>(result: Promise<T>, onCancel: () => void) {
  return Object.assign(result, { cancel: onCancel })
}

// stands in for a pool whose connections are all busy: the query is queued and never answered
function queuedForever(): StubbedSql {
  let cancelled = 0
  const sql = () => stubbedQuery(new Promise(() => {}), () => cancelled++)

  return { sql: sql as unknown as Sql, cancelledQueries: () => cancelled }
}

function answering(rows: unknown[]): StubbedSql {
  let cancelled = 0
  const sql = () => stubbedQuery(Promise.resolve(rows), () => cancelled++)

  return { sql: sql as unknown as Sql, cancelledQueries: () => cancelled }
}

describe('postgres readiness', () => {
  test('answers well inside the Docker health check timeout of 3 s', () => {
    expect(readinessTimeoutMs).toBeLessThan(3_000)
  })

  test('fails as not ready when the database does not answer in time', async () => {
    const pool = queuedForever()
    const readiness = createPostgresReadiness(pool.sql, [migration], { timeoutMs: 20 })
    const startedAt = performance.now()

    await expect(readiness.check()).rejects.toThrow(
      'postgres readiness: the database did not answer within 20 ms (pool busy or database unreachable)',
    )

    expect(performance.now() - startedAt).toBeLessThan(500)
    // a timed-out probe leaves the queue, so probes during saturation don't pile up
    expect(pool.cancelledQueries()).toBe(1)
  })

  test('passes when the known migrations are applied', async () => {
    const pool = answering([migration])
    const readiness = createPostgresReadiness(pool.sql, [migration], { timeoutMs: 20 })

    await expect(readiness.check()).resolves.toBeUndefined()
    expect(pool.cancelledQueries()).toBe(0)
  })

  test('still reports a missing migration rather than a timeout', async () => {
    const readiness = createPostgresReadiness(answering([]).sql, [migration], { timeoutMs: 20 })

    await expect(readiness.check()).rejects.toThrow('schema migration refresh-operations/0001 is not applied')
  })
})
