import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { type TestDatabase, createTestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations'
import { apiMaxConnections, createWorkerDatabases, listenerConnections, workerPoolSizes } from '../src/database-pools'
import { readOperationsWorkerConfig } from '../src/operations-worker-config'
import {
  allocatePort,
  deferLeaderboardSchedules,
  migrateDatabase,
  spawnRuntime,
  waitFor,
  waitForExit,
  waitForRuntimeReady,
} from './fixtures/runtime-processes'

let database: TestDatabase

const workerApplicationNames = [
  'brawltome-operations-worker',
  'brawltome-operations-worker-renewals',
  'brawltome-operations-worker-discovery',
]

const internalSecret = 'database-connections-secret-32-characters'
const metricsSecret = 'database-connections-metrics-secret-32-chars'
const workerConfig = readOperationsWorkerConfig({})

beforeAll(async () => {
  database = await createTestDatabase({ label: 'database_connections', modules: [] })
  await migrateDatabase(database.connectionString)
  await deferLeaderboardSchedules(database)
}, 60_000)

afterAll(async () => {
  await database?.drop()
})

type ConnectionCounts = Record<string, number>

// every connection to the test database except the test's own client, by application name. a connection that is
// still starting up shows no state and no application name yet, so it is skipped until its name is set
async function connectionCounts(): Promise<ConnectionCounts> {
  const rows = await database.sql<{ application_name: string; count: number }[]>`
    SELECT application_name, count(*)::int AS count
    FROM pg_stat_activity
    WHERE datname = current_database() AND backend_type = 'client backend' AND state IS NOT NULL
      AND application_name <> 'brawltome-test'
    GROUP BY application_name
  `

  return Object.fromEntries(rows.map((row) => [row.application_name, row.count]))
}

// samples connection counts until the work settles and keeps the highest count seen per application name
async function peakConnectionsDuring(work: Promise<unknown>): Promise<ConnectionCounts> {
  const peak: ConnectionCounts = {}
  let isSettled = false

  const settled = work.finally(() => {
    isSettled = true
  })

  while (!isSettled) {
    for (const [name, count] of Object.entries(await connectionCounts())) {
      peak[name] = Math.max(peak[name] ?? 0, count)
    }

    await Bun.sleep(10)
  }

  await settled

  return peak
}

function trpcUrl(port: number, procedure: string, input: unknown): string {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }))

  return `http://127.0.0.1:${port}/trpc/${procedure}?input=${encoded}`
}

// reads that land in different modules: ranking, discovery, player, clan, refresh operations and admission
function apiRequests(port: number): Array<() => Promise<Response>> {
  const internal = { headers: { 'x-internal-secret': internalSecret } }
  const metrics = { headers: { 'x-metrics-secret': metricsSecret } }

  return [
    () => fetch(trpcUrl(port, 'leaderboard.get', { mode: '1v1', region: 'all', page: 1 })),
    () => fetch(trpcUrl(port, 'search.local', { query: 'connection burst' })),
    () => fetch(trpcUrl(port, 'player.rankedById', { id: 1 }), internal),
    () => fetch(trpcUrl(port, 'player.careerById', { id: 1 }), internal),
    () => fetch(trpcUrl(port, 'player.referenceById', { id: 1 }), internal),
    () => fetch(trpcUrl(port, 'clan.byId', { id: 1 }), internal),
    () => fetch(`http://127.0.0.1:${port}/metrics`, metrics),
  ]
}

async function burst(port: number, requestsPerKind: number): Promise<void> {
  const requests = apiRequests(port).flatMap((request) => Array.from({ length: requestsPerKind }, () => request()))
  const responses = await Promise.all(requests)

  for (const response of responses) {
    expect(response.status, await response.text()).toBe(200)
  }
}

describe('one database client per process', () => {
  test('the API stays within its pool and listener after a burst across modules', async () => {
    const port = await allocatePort()

    const api = spawnRuntime('apps/api/src/serve.ts', {
      DATABASE_URL: database.connectionString,
      INTERNAL_API_SECRET: internalSecret,
      METRICS_SCRAPE_SECRET: metricsSecret,
      REFRESH_TRUST_COOKIE_SECRET: 'database-connections-refresh-trust-secret-32-chars',
      REPLAY_BRIDGE_SECRET: 'database-connections-replay-bridge-secret-32-chars',
      PORT: String(port),
      RUNTIME_SHUTDOWN_DEADLINE_MS: '2000',
      RUNTIME_CLEANUP_RESERVE_MS: '500',
    })

    try {
      await waitForRuntimeReady(api, port, 'API readiness')

      const peak = await peakConnectionsDuring(burst(port, 30))

      expect(Object.keys(peak)).toEqual(['brawltome-api'])
      expect(peak['brawltome-api']).toBeLessThanOrEqual(apiMaxConnections + listenerConnections)
    } finally {
      api.process.kill('SIGTERM')
      const exited = await waitForExit(api, 5_000)

      expect(exited.exitCode, exited.stderr).toBe(0)
    }

    await waitFor(async () => Object.keys(await connectionCounts()).length === 0, 'API connections to close')
  }, 60_000)

  test('the worker stays within its main, renewal and discovery pools while it works', async () => {
    const port = await allocatePort()
    const sizes = workerPoolSizes(workerConfig.admission.totalConcurrency)
    const operations = createPostgresRefreshOperations({ database })

    const accepted = await Promise.all(
      Array.from({ length: 20 }, () =>
        operations.accept({
          dedupeKey: `connection-burst:${randomUUID()}`,
          operationKey: `connection-burst-effect:${randomUUID()}`,
          workClass: 'interactive',
          payload: { value: 'connection-burst' },
          provenance: { source: 'database-connections-test', requestedBy: 'database-connections-test' },
        }),
      ),
    )

    const worker = spawnRuntime('apps/api/src/operations-worker.ts', {
      DATABASE_URL: database.connectionString,
      BRAWLHALLA_API_KEY: 'database-connections-test-api-key',
      INTERNAL_API_SECRET: internalSecret,
      METRICS_SCRAPE_SECRET: metricsSecret,
      HEALTH_PORT: String(port),
      OPERATIONS_LEASE_MS: '5000',
      OPERATIONS_POLL_MS: '25',
      RUNTIME_SHUTDOWN_DEADLINE_MS: '4000',
      RUNTIME_CLEANUP_RESERVE_MS: '1000',
    })

    try {
      await waitForRuntimeReady(worker, port, 'worker readiness')

      const allSucceeded = waitFor(
        async () => {
          const states = await Promise.all(accepted.map(({ operationId }) => operations.inspect(operationId)))

          return states.every((state) => state.operation.status === 'succeeded')
        },
        'the queued operations to succeed',
        30_000,
      )

      const peak = await peakConnectionsDuring(allSucceeded)

      expect(peak['brawltome-operations-worker']).toBeGreaterThan(0)
      for (const name of Object.keys(peak)) {
        expect(workerApplicationNames).toContain(name)
      }

      expect(peak['brawltome-operations-worker']).toBeLessThanOrEqual(sizes.main + listenerConnections)
      expect(peak['brawltome-operations-worker-renewals'] ?? 0).toBeLessThanOrEqual(sizes.renewals)
      expect(peak['brawltome-operations-worker-discovery'] ?? 0).toBeLessThanOrEqual(sizes.discovery)
    } finally {
      worker.process.kill('SIGTERM')
      const exited = await waitForExit(worker, 8_000)

      expect(exited.exitCode, exited.stderr).toBe(0)
    }

    await waitFor(async () => Object.keys(await connectionCounts()).length === 0, 'worker connections to close')
  }, 90_000)

  test('only the worker discovery client gets the long discovery statement timeout', async () => {
    const databases = createWorkerDatabases(database.connectionString, workerConfig)

    try {
      const timeouts = await Promise.all(
        [databases.main, databases.renewals, databases.discovery].map(async ({ sql }) => {
          const [row] = await sql<{ statement_timeout: string }[]>`SHOW statement_timeout`

          return row.statement_timeout
        }),
      )

      expect(timeouts).toEqual(['5min', '5min', '30min'])
    } finally {
      await Promise.all([databases.main.close(), databases.renewals.close(), databases.discovery.close()])
    }
  })

  test('a lease renewal completes while every main connection is held by a long transaction', async () => {
    const databases = createWorkerDatabases(database.connectionString, workerConfig)
    const operations = createPostgresRefreshOperations({ database: databases.main, renewals: databases.renewals })
    const holdSeconds = 3

    try {
      await operations.configureAdmission(workerConfig.admission)

      await operations.accept({
        dedupeKey: `renewal-isolation:${randomUUID()}`,
        operationKey: `renewal-isolation-effect:${randomUUID()}`,
        workClass: 'interactive',
        payload: { value: 'renewal-isolation' },
        provenance: { source: 'database-connections-test', requestedBy: 'database-connections-test' },
      })

      const lease = await operations.claim('renewal-isolation', 30_000, workerConfig.admission)

      if (!lease) throw new Error('expected the accepted operation to be claimed')

      const mainSize = workerPoolSizes(workerConfig.admission.totalConcurrency).main

      const held = Array.from({ length: mainSize }, () =>
        databases.main.sql.begin((transaction) => transaction`SELECT pg_sleep(${holdSeconds})`),
      )

      await waitFor(
        async () => (await connectionCounts())['brawltome-operations-worker'] === mainSize,
        'every main connection to be held',
      )

      const startedAt = Date.now()
      const renewal = await operations.renew(lease, 30_000)
      const renewalMs = Date.now() - startedAt

      expect(renewal).toBe('renewed')
      expect(renewalMs).toBeLessThan(1_000)
      await Promise.all(held)
    } finally {
      await Promise.all([databases.main.close(), databases.renewals.close(), databases.discovery.close()])
    }
  }, 30_000)
})
