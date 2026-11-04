import { type Database, createDatabase } from '@brawltome/foundation'
import {
  maxProjectionConcurrency,
  type readOperationsWorkerConfig,
  workerDatabaseUrl,
} from './operations-worker-config'

// Connection budget: every number here feeds the deploy worst case in CONTRIBUTING.md (Production) and
// tests/database-pools.test.ts, which fails when the sum no longer fits Postgres max_connections.

export const apiMaxConnections = 20

// postgres.js runs LISTEN on one dedicated connection beside the pool, under the same application name
export const listenerConnections = 1

// One per job slot, plus the scheduler loop, a health check, a metrics scrape and the one claim that may look up a
// discovery effect inside its transaction (claims queue on an advisory lock, so only one nests at a time).
const workerMainExtraConnections = 4

// Only projection operations use this pool, at most maxProjectionConcurrency at once. A reconciliation can hold one
// connection while it asks for a second (player: its source snapshot, then the write; clan: the write, then a repair
// snapshot), and a delivery holding one can wait on a reconciliation's discovery lock. With one connection more than
// there are operations, some operation can always get the connection it waits for and finish. With fewer they can
// all wait on each other until the idle-in-transaction timeout ends them.
const workerDiscoveryMaxConnections = maxProjectionConcurrency + 1

// the one list of worker clients: WorkerDatabases has exactly these keys, so a new client needs a size here and the
// connection budget test counts it
export type WorkerPoolSizes = {
  main: number
  // lease renewals get their own pool so a busy main pool can never let a running lease expire
  renewals: number
  // discovery reconciliation runs statements far longer than the worker's statement timeout allows
  discovery: number
}

export type WorkerDatabases = { [Client in keyof WorkerPoolSizes]: Database }

type WorkerConfig = ReturnType<typeof readOperationsWorkerConfig>

export function workerPoolSizes(totalConcurrency: number): WorkerPoolSizes {
  return {
    main: totalConcurrency + workerMainExtraConnections,
    renewals: totalConcurrency,
    discovery: workerDiscoveryMaxConnections,
  }
}

export function createApiDatabase(connectionString: string): Database {
  return createDatabase(connectionString, { maxConnections: apiMaxConnections, applicationName: 'brawltome-api' })
}

export function createWorkerDatabases(connectionString: string, config: WorkerConfig): WorkerDatabases {
  const sizes = workerPoolSizes(config.admission.totalConcurrency)
  const workerUrl = workerDatabaseUrl(connectionString, config.database)
  // the timeout goes in the URL like the worker's other session settings: postgres.js lets URL parameters win over
  // connection options, so an operator's own statement_timeout in DATABASE_URL still applies
  const discoveryUrl = workerDatabaseUrl(connectionString, {
    ...config.database,
    statementTimeoutMs: config.discovery.statementTimeoutMs,
  })

  return {
    main: createDatabase(workerUrl, { maxConnections: sizes.main, applicationName: 'brawltome-operations-worker' }),
    renewals: createDatabase(workerUrl, {
      maxConnections: sizes.renewals,
      applicationName: 'brawltome-operations-worker-renewals',
    }),
    discovery: createDatabase(discoveryUrl, {
      maxConnections: sizes.discovery,
      applicationName: 'brawltome-operations-worker-discovery',
    }),
  }
}
