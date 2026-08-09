import { describe, expect, test } from 'bun:test'
import { readOperationsWorkerConfig } from '../src/operations-worker-config'
import { readHealthPort, readRuntimeConfig } from '../src/runtime-config'

describe('operations worker configuration', () => {
  test('uses conservative runtime defaults and rejects unsafe values', () => {
    expect(readOperationsWorkerConfig({})).toEqual({
      leaseMs: 30_000,
      pollMs: 1_000,
      retryDelayMs: 1_000,
      scheduleBatchSize: 100,
      admission: {
        totalConcurrency: 8,
        interactiveReservation: 2,
        classConcurrency: {
          interactive: 4,
          'primary-monitoring': 2,
          leaderboard: 1,
          'global-statistics': 1,
          projection: 2,
          maintenance: 1,
        },
        backgroundWeights: {
          'primary-monitoring': 8,
          leaderboard: 4,
          'global-statistics': 2,
          projection: 4,
          maintenance: 1,
        },
      },
    })
    for (const value of ['0', '-1', 'NaN', '1.5', '999999999']) {
      expect(() => readOperationsWorkerConfig({ OPERATIONS_LEASE_MS: value })).toThrow('OPERATIONS_LEASE_MS')
    }
  })

  test('validates reservation, class limits, and weights as one policy', () => {
    expect(() => readOperationsWorkerConfig({ OPERATIONS_TOTAL_CONCURRENCY: '33' })).toThrow(
      'OPERATIONS_TOTAL_CONCURRENCY',
    )
    expect(() =>
      readOperationsWorkerConfig({
        OPERATIONS_TOTAL_CONCURRENCY: '4',
        OPERATIONS_INTERACTIVE_RESERVATION: '4',
      }),
    ).toThrow('interactiveReservation')
    expect(() =>
      readOperationsWorkerConfig({
        OPERATIONS_INTERACTIVE_RESERVATION: '3',
        OPERATIONS_INTERACTIVE_CONCURRENCY: '2',
      }),
    ).toThrow('classConcurrency.interactive')
    expect(() => readOperationsWorkerConfig({ OPERATIONS_MAINTENANCE_WEIGHT: '0' })).toThrow(
      'OPERATIONS_MAINTENANCE_WEIGHT',
    )
  })

  test('uses a validated 60-second shutdown deadline', () => {
    expect(readRuntimeConfig({})).toEqual({ shutdownDeadlineMs: 60_000, cleanupReserveMs: 5_000 })
    expect(readRuntimeConfig({ RUNTIME_SHUTDOWN_DEADLINE_MS: '10000', RUNTIME_CLEANUP_RESERVE_MS: '1000' })).toEqual({
      shutdownDeadlineMs: 10_000,
      cleanupReserveMs: 1_000,
    })
    expect(() => readRuntimeConfig({ RUNTIME_SHUTDOWN_DEADLINE_MS: '999' })).toThrow('RUNTIME_SHUTDOWN_DEADLINE_MS')
    expect(() =>
      readRuntimeConfig({ RUNTIME_SHUTDOWN_DEADLINE_MS: '10000', RUNTIME_CLEANUP_RESERVE_MS: '10000' }),
    ).toThrow('RUNTIME_CLEANUP_RESERVE_MS')
    expect(readHealthPort(undefined, 3001)).toBe(3001)
    expect(() => readHealthPort('70000', 3001)).toThrow('HEALTH_PORT')
  })
})
