import { describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { readOperationsWorkerConfig, workerDatabaseUrl } from '../src/operations-worker-config'

const baseUrl = process.env.DATABASE_URL

describe('operations worker database sessions', () => {
  test('applies bounded statement and idle-transaction timeouts to every worker session', async () => {
    if (!baseUrl) throw new Error('DATABASE_URL is required for operations worker database tests')
    const defaults = postgres(workerDatabaseUrl(baseUrl, readOperationsWorkerConfig({}).database), { max: 1 })
    try {
      const [statement] = await defaults<{ statement_timeout: string }[]>`SHOW statement_timeout`
      const [idle] = await defaults<{ idle_in_transaction_session_timeout: string }[]>`
        SHOW idle_in_transaction_session_timeout
      `
      expect(statement.statement_timeout).toBe('5min')
      expect(idle.idle_in_transaction_session_timeout).toBe('5min')
    } finally {
      await defaults.end()
    }

    const tight = postgres(
      workerDatabaseUrl(baseUrl, {
        connectTimeoutSeconds: 10,
        statementTimeoutMs: 100,
        idleInTransactionSessionTimeoutMs: 100,
      }),
      { max: 1 },
    )
    try {
      const failure = await tight`SELECT pg_sleep(1)`.then(
        () => null,
        (error: unknown) => error,
      )
      expect(failure).toMatchObject({ code: '57014' })
    } finally {
      await tight.end()
    }
  })
})
