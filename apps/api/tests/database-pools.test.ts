import { describe, expect, test } from 'bun:test'
import { migrationRunnerConnections } from '@brawltome/foundation'
import { apiMaxConnections, listenerConnections, workerPoolSizes } from '../src/database-pools'
import { maxOperationsTotalConcurrency, readOperationsWorkerConfig } from '../src/operations-worker-config'

// keep in step with the Production section of CONTRIBUTING.md
const postgresMaxConnections = 100
// Postgres keeps superuser_reserved_connections (default 3) for superusers; brawltome_runtime is not one
const superuserReservedConnections = 3

describe('database pool sizes', () => {
  test('a deploy at the largest worker concurrency stays inside the Postgres connection limit', () => {
    const api = apiMaxConnections + listenerConnections
    const worker = workerPoolSizes(maxOperationsTotalConcurrency)
    // a rolling deploy runs two APIs beside one worker; the worker is replaced, not overlapped
    const runtimeConnections = 2 * api + worker.main + listenerConnections + worker.renewals + worker.discovery

    expect(runtimeConnections).toBeLessThanOrEqual(postgresMaxConnections - superuserReservedConnections)
    expect(runtimeConnections + migrationRunnerConnections).toBeLessThan(postgresMaxConnections)
  })

  test('the worker refuses a total concurrency above the bound the budget is computed for', () => {
    const atBound = readOperationsWorkerConfig({ OPERATIONS_TOTAL_CONCURRENCY: String(maxOperationsTotalConcurrency) })

    expect(atBound.admission.totalConcurrency).toBe(maxOperationsTotalConcurrency)
    expect(() =>
      readOperationsWorkerConfig({ OPERATIONS_TOTAL_CONCURRENCY: String(maxOperationsTotalConcurrency + 1) }),
    ).toThrow('OPERATIONS_TOTAL_CONCURRENCY')
  })

  test('the worker main pool leaves room for the scheduler and one nested lookup beside every job slot', () => {
    expect(workerPoolSizes(8)).toEqual({ main: 12, renewals: 8, discovery: 3 })
  })
})
