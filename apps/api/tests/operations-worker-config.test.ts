import { describe, expect, test } from 'bun:test'
import {
  leaderboardScheduleDefinitions,
  readBrawlhallaV1RequestLimit,
  readOperationsWorkerConfig,
  readSourceBackgroundHeadroom,
} from '../src/operations-worker-config'
import { readHealthPort, readRuntimeConfig } from '../src/runtime-config'

describe('operations worker configuration', () => {
  test('uses conservative runtime defaults and rejects unsafe values', () => {
    expect(readOperationsWorkerConfig({})).toEqual({
      leaseMs: 30_000,
      pollMs: 1_000,
      retryDelayMs: 1_000,
      scheduleBatchSize: 100,
      discovery: {
        projectionBatchSize: 500,
        reconciliationIntervalMs: 60 * 60 * 1000,
      },
      leaderboard: {
        pageDepth: 1,
        intervalMs: 15 * 60 * 1000,
        firstDueAt: '2020-01-01T00:00:00.000Z',
      },
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
    expect(() => readOperationsWorkerConfig({ LEADERBOARD_PAGE_DEPTH: '21' })).toThrow('LEADERBOARD_PAGE_DEPTH')
    expect(() => readOperationsWorkerConfig({ DISCOVERY_PROJECTION_BATCH_SIZE: '1001' })).toThrow(
      'DISCOVERY_PROJECTION_BATCH_SIZE',
    )
    expect(() => readOperationsWorkerConfig({ DISCOVERY_RECONCILIATION_INTERVAL_MS: '59999' })).toThrow(
      'DISCOVERY_RECONCILIATION_INTERVAL_MS',
    )
    for (const value of ['0', '59999', '60000.5', '86400001']) {
      expect(() => readOperationsWorkerConfig({ LEADERBOARD_INTERVAL_MS: value })).toThrow('LEADERBOARD_INTERVAL_MS')
    }
  })

  test('validates the source ceiling and explicit background headroom', () => {
    expect(readBrawlhallaV1RequestLimit(undefined)).toBe(102)
    expect(readBrawlhallaV1RequestLimit('102')).toBe(102)
    expect(() => readBrawlhallaV1RequestLimit('103')).toThrow('BRAWLHALLA_V1_REQUEST_LIMIT')
    expect(readSourceBackgroundHeadroom(undefined, 102)).toBe(30)
    expect(readSourceBackgroundHeadroom('30', 102)).toBe(30)
    expect(() => readSourceBackgroundHeadroom('102', 102)).toThrow('SOURCE_BACKGROUND_HEADROOM')
  })

  test('defines four deterministic staggered schedules in the existing leaderboard work class', () => {
    const definitions = leaderboardScheduleDefinitions(readOperationsWorkerConfig({}).leaderboard)
    expect(definitions.map(({ mode, kind, workClass }) => ({ mode, kind, workClass }))).toEqual([
      { mode: '1v1', kind: 'leaderboard-1v1', workClass: 'leaderboard' },
      { mode: '2v2', kind: 'leaderboard-2v2', workClass: 'leaderboard' },
      { mode: 'solo2v2', kind: 'leaderboard-solo-2v2', workClass: 'leaderboard' },
      { mode: '3v3', kind: 'leaderboard-3v3', workClass: 'leaderboard' },
    ])
    expect(definitions.map(({ firstDueAt }) => firstDueAt)).toEqual([
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:03:45.000Z',
      '2020-01-01T00:07:30.000Z',
      '2020-01-01T00:11:15.000Z',
    ])
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
