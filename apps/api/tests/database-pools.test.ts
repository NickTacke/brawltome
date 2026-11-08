import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { migrationRunnerConnections } from '@brawltome/foundation'
import {
  apiMaxConnections,
  createWorkerDatabases,
  listenerConnections,
  type WorkerPoolSizes,
  workerPoolSizes,
} from '../src/database-pools'
import {
  maxOperationsTotalConcurrency,
  maxProjectionConcurrency,
  readOperationsWorkerConfig,
} from '../src/operations-worker-config'

const postgresMaxConnections = 100
// Postgres keeps superuser_reserved_connections (default 3) for superusers; brawltome_runtime is not one
const superuserReservedConnections = 3
const runtimeRoleBudget = postgresMaxConnections - superuserReservedConnections
// the clients that also LISTEN, on one extra connection each
const listeningWorkerClients: ReadonlySet<keyof WorkerPoolSizes> = new Set(['main'])

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function apiConnections(): number {
  return apiMaxConnections + listenerConnections
}

function workerConnections(totalConcurrency: number): number {
  return sum(Object.values(workerPoolSizes(totalConcurrency))) + listeningWorkerClients.size * listenerConnections
}

// a rolling deploy runs two APIs beside one worker; the worker is replaced, not overlapped
function runtimeWorstCase(totalConcurrency: number): number {
  return 2 * apiConnections() + workerConnections(totalConcurrency)
}

// a pool size as CONTRIBUTING.md writes it: "3", "c" or "c + 4"
function sizeFormula(size: (totalConcurrency: number) => number): string {
  const intercept = size(0)
  const slope = size(1) - intercept

  if (slope === 0) return String(intercept)

  if (slope !== 1) throw new Error(`pool size grows by ${slope} per job slot; extend sizeFormula to write it`)

  return intercept === 0 ? 'c' : `c + ${intercept}`
}

function productionSection(): string {
  const contributing = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8')
  const start = contributing.indexOf('\n## Production')
  const end = contributing.indexOf('\n## ', start + 1)

  if (start === -1) throw new Error('CONTRIBUTING.md has no Production section')

  return contributing.slice(start, end === -1 ? undefined : end)
}

describe('database pool sizes', () => {
  test('a deploy at the largest worker concurrency stays inside the Postgres connection limit', () => {
    const runtimeConnections = runtimeWorstCase(maxOperationsTotalConcurrency)

    expect(runtimeConnections).toBeLessThanOrEqual(runtimeRoleBudget)
    expect(runtimeConnections + migrationRunnerConnections).toBeLessThan(postgresMaxConnections)
  })

  test('the worker opens exactly the clients the budget counts, at their counted sizes', async () => {
    const config = readOperationsWorkerConfig({})
    const sizes = workerPoolSizes(config.admission.totalConcurrency)
    // postgres.js connects on the first query, so this opens no connection
    const databases = createWorkerDatabases('postgres://budget-check@127.0.0.1:1/budget_check', config)

    try {
      const openedSizes = Object.fromEntries(
        Object.entries(databases).map(([client, database]) => [client, database.sql.options.max]),
      )

      expect(openedSizes).toEqual(sizes)
    } finally {
      await Promise.all(Object.values(databases).map((database) => database.close()))
    }
  })

  test('CONTRIBUTING.md shows the sizes and the numbers this budget computes', () => {
    const section = productionSection()
    const worstCase = runtimeWorstCase(maxOperationsTotalConcurrency)
    const intercept = runtimeWorstCase(0)
    const slope = runtimeWorstCase(1) - intercept

    expect(section).toContain(`| ${apiMaxConnections} + ${listenerConnections} listener |`)
    for (const client of Object.keys(workerPoolSizes(0)) as (keyof WorkerPoolSizes)[]) {
      const formula = sizeFormula((totalConcurrency) => workerPoolSizes(totalConcurrency)[client])
      const cell = listeningWorkerClients.has(client) ? `${formula}, + ${listenerConnections} listener` : formula

      expect(section).toContain(`| ${cell} |`)
    }

    expect(section).toContain(`| migration runner | ${migrationRunnerConnections} |`)
    expect(section).toContain(`at most ${maxOperationsTotalConcurrency}`)
    expect(section).toContain(`\`OPERATIONS_PROJECTION_CONCURRENCY\` is at most ${maxProjectionConcurrency}`)
    expect(section).toContain(`2 × ${apiConnections()}`)
    expect(section).toContain(`= ${intercept} + ${slope}c`)
    expect(section).toContain(`${worstCase} at c = ${maxOperationsTotalConcurrency}`)
    expect(section).toContain(`the runtime role gets ${runtimeRoleBudget}`)
    expect(section).toContain(`the total is ${worstCase + migrationRunnerConnections}`)
  })

  // a reconciliation may hold one discovery connection while it waits for another, so the pool needs one more
  // connection than the projection operations that can run at once, or they can all end up waiting on each other
  test('the discovery pool has a connection more than the projection operations allowed at once', () => {
    const atBound = readOperationsWorkerConfig({ OPERATIONS_PROJECTION_CONCURRENCY: String(maxProjectionConcurrency) })

    expect(atBound.admission.classConcurrency.projection).toBe(maxProjectionConcurrency)

    expect(() =>
      readOperationsWorkerConfig({ OPERATIONS_PROJECTION_CONCURRENCY: String(maxProjectionConcurrency + 1) }),
    ).toThrow('OPERATIONS_PROJECTION_CONCURRENCY')

    for (let totalConcurrency = 1; totalConcurrency <= maxOperationsTotalConcurrency; totalConcurrency++) {
      expect(workerPoolSizes(totalConcurrency).discovery).toBeGreaterThanOrEqual(maxProjectionConcurrency + 1)
    }
  })

  test('the worker refuses a total concurrency above the bound the budget is computed for', () => {
    const atBound = readOperationsWorkerConfig({ OPERATIONS_TOTAL_CONCURRENCY: String(maxOperationsTotalConcurrency) })

    expect(atBound.admission.totalConcurrency).toBe(maxOperationsTotalConcurrency)

    expect(() =>
      readOperationsWorkerConfig({ OPERATIONS_TOTAL_CONCURRENCY: String(maxOperationsTotalConcurrency + 1) }),
    ).toThrow('OPERATIONS_TOTAL_CONCURRENCY')
  })
})
