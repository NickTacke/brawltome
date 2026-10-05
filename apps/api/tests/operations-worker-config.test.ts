import { describe, expect, test } from 'bun:test'
import {
  leaderboardScheduleDefinitions,
  readBrawlhallaV1RequestLimit,
  readOperationsWorkerConfig,
  readSourceBackgroundHeadroom,
  workerDatabaseUrl,
} from '../src/operations-worker-config'
import { readHealthPort, readRuntimeConfig } from '../src/runtime-config'

describe('operations worker configuration', () => {
  test('uses conservative runtime defaults and rejects unsafe values', () => {
    expect(readOperationsWorkerConfig({})).toEqual({
      leaseMs: 30_000,
      pollMs: 1_000,
      retryDelayMs: 2_000,
      retryBackoff: { multiplier: 3, maxDelayMs: 15_000, jitterRatio: 0.2 },
      sourceUnavailableRetryMs: 60_000,
      scheduleBatchSize: 100,
      stallTimeoutMs: 10 * 60 * 1000,
      database: {
        connectTimeoutSeconds: 10,
        statementTimeoutMs: 5 * 60 * 1000,
        idleInTransactionSessionTimeoutMs: 5 * 60 * 1000,
      },
      discovery: {
        projectionBatchSize: 500,
        reconciliationIntervalMs: 60 * 60 * 1000,
        reconciliationFailureBackoffMs: 5 * 60 * 1000,
        reconciliationMaxFailureBackoffMs: 60 * 60 * 1000,
      },
      leaderboard: {
        pageDepth: 20,
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
    expect(() => readOperationsWorkerConfig({ SOURCE_UNAVAILABLE_RETRY_MS: '999' })).toThrow(
      'SOURCE_UNAVAILABLE_RETRY_MS',
    )
    expect(() => readOperationsWorkerConfig({ DISCOVERY_PROJECTION_BATCH_SIZE: '1001' })).toThrow(
      'DISCOVERY_PROJECTION_BATCH_SIZE',
    )
    expect(() => readOperationsWorkerConfig({ DISCOVERY_RECONCILIATION_INTERVAL_MS: '59999' })).toThrow(
      'DISCOVERY_RECONCILIATION_INTERVAL_MS',
    )
    expect(
      readOperationsWorkerConfig({
        OPERATIONS_RETRY_DELAY_MS: '1000',
        OPERATIONS_RETRY_BACKOFF_MULTIPLIER: '2',
        OPERATIONS_RETRY_MAX_DELAY_MS: '8000',
      }),
    ).toMatchObject({ retryDelayMs: 1_000, retryBackoff: { multiplier: 2, maxDelayMs: 8_000, jitterRatio: 0.2 } })
    expect(() => readOperationsWorkerConfig({ OPERATIONS_RETRY_BACKOFF_MULTIPLIER: '0' })).toThrow(
      'OPERATIONS_RETRY_BACKOFF_MULTIPLIER',
    )
    expect(() => readOperationsWorkerConfig({ OPERATIONS_RETRY_MAX_DELAY_MS: '1999' })).toThrow(
      'OPERATIONS_RETRY_MAX_DELAY_MS',
    )
    expect(() => readOperationsWorkerConfig({ DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS: '59999' })).toThrow(
      'DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS',
    )
    expect(() =>
      readOperationsWorkerConfig({
        DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS: '600000',
        DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS: '599999',
      }),
    ).toThrow('DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS')
    for (const value of ['0', '59999', '60000.5', '86400001']) {
      expect(() => readOperationsWorkerConfig({ LEADERBOARD_INTERVAL_MS: value })).toThrow('LEADERBOARD_INTERVAL_MS')
    }
  })

  test('bounds worker database sessions without overriding explicit connection parameters', () => {
    const database = readOperationsWorkerConfig({}).database
    const bounded = new URL(workerDatabaseUrl('postgres://worker:p%40ss@db:5432/brawltome?sslmode=disable', database))
    expect(bounded.password).toBe('p%40ss')
    expect(Object.fromEntries(bounded.searchParams)).toEqual({
      sslmode: 'disable',
      connect_timeout: '10',
      statement_timeout: '300000',
      idle_in_transaction_session_timeout: '300000',
    })
    const explicit = new URL(workerDatabaseUrl('postgres://worker@db/brawltome?statement_timeout=900000', database))
    expect(explicit.searchParams.get('statement_timeout')).toBe('900000')
    expect(() => readOperationsWorkerConfig({ OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS: '999' })).toThrow(
      'OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS',
    )
    expect(() => readOperationsWorkerConfig({ OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS: '0' })).toThrow(
      'OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS',
    )
    expect(() => readOperationsWorkerConfig({ OPERATIONS_STALL_TIMEOUT_MS: '59999' })).toThrow(
      'OPERATIONS_STALL_TIMEOUT_MS',
    )
  })

  test('validates the source ceiling and explicit background headroom', () => {
    expect(readBrawlhallaV1RequestLimit(undefined)).toBe(1_800)
    expect(readBrawlhallaV1RequestLimit('1800')).toBe(1_800)
    expect(() => readBrawlhallaV1RequestLimit('1801')).toThrow('BRAWLHALLA_V1_REQUEST_LIMIT')
    expect(readSourceBackgroundHeadroom(undefined, 180)).toBe(30)
    expect(readSourceBackgroundHeadroom('30', 180)).toBe(30)
    expect(() => readSourceBackgroundHeadroom('180', 180)).toThrow('SOURCE_BACKGROUND_HEADROOM')
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
