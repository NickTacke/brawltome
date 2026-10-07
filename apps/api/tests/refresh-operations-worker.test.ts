import { describe, expect, test } from 'bun:test'
import { BhApiHttpError } from '@brawltome/bhapi'
import { RateLimitError } from '@brawltome/bhapi'
import { LeaderboardSourceError } from '@brawltome/ranking/composition'
import type { AdmissionConfig, OperationFailure, OperationLease } from '@brawltome/refresh-operations'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { retryDelayForAttempt, runOneRefreshOperation } from '../src/refresh-operations-worker'

const admission: AdmissionConfig = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
}

describe('refresh operations worker source retry', () => {
  test('correlates attempts in logs while keeping IDs out of metric labels and isolating exporter failure', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'proof:telemetry',
      kind: 'proof',
      workClass: 'interactive',
      payload: { value: 'proof' },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
    let completed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      commitProofEffect: async () => 'applied' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    expect(
      await runOneRefreshOperation(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
      }),
    ).toBe(true)
    await telemetry.flush(50)

    expect(completed).toBe(true)
    expect(sink.records.some((record) => record.attributes?.operationId === lease.operationId)).toBe(true)
    const metricText = JSON.stringify(telemetry.metrics.snapshot())
    expect(metricText).not.toContain(lease.operationId)
    expect(metricText).toContain('operation_attempts_total')

    const failingTelemetry = createTelemetry({
      service: 'worker',
      sink: {
        export: async () => {
          throw new Error('offline')
        },
      },
      drainIntervalMs: 0,
    })
    completed = false
    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry: failingTelemetry,
    })
    await expect(failingTelemetry.shutdown(5)).resolves.toBeUndefined()
    expect(completed).toBe(true)
  })

  test('reports lease_lost when the failure transition is fenced', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'proof:fenced-failure',
      kind: 'proof',
      workClass: 'interactive',
      payload: { value: 'proof' },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      fail: async () => 'lease-lost' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      executeEffect: async () => {
        throw new Error('execution failed')
      },
    })

    const attempts = telemetry.metrics.snapshot().find(({ name }) => name === 'operation_attempts_total')
    expect(attempts?.series[0]?.labels.outcome).toBe('lease_lost')
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
    expect(failures?.series[0]?.labels.failure_category).toBe('lease_lost')
  })

  test('logs failed attempts with safe structured failure codes instead of free text', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'proof:diagnosable-failure',
      kind: 'proof',
      workClass: 'interactive',
      payload: { value: 'proof' },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      fail: async () => 'transitioned' as const,
    }
    const failedRecords = async (error: Error) => {
      const sink = createMemorySink()
      const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
      await runOneRefreshOperation(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
        executeEffect: async () => {
          throw error
        },
      })
      await telemetry.flush(50)
      return sink.records.filter((record) => record.event === 'operation.attempt.failed')
    }

    const [sourceFailure] = await failedRecords(
      new LeaderboardSourceError('source_contract_invalid', 'GET https://x/?api_key=leaked-key failed', false),
    )
    expect(sourceFailure?.error).toMatchObject({ code: 'source_contract_invalid' })
    expect(sourceFailure?.attributes).toMatchObject({ failureCode: 'source_contract_invalid' })
    expect(JSON.stringify(sourceFailure)).not.toContain('leaked-key')

    const [postgresFailure] = await failedRecords(
      Object.assign(new Error('relation "secret_table" does not exist'), { code: '42P01' }),
    )
    expect(postgresFailure?.error).toMatchObject({ code: '42P01' })
    expect(postgresFailure?.attributes).toMatchObject({ failureCode: '42P01' })
    expect(JSON.stringify(postgresFailure)).not.toContain('secret_table')

    const [genericFailure] = await failedRecords(new Error('execution failed'))
    expect(genericFailure?.attributes).toMatchObject({ failureCode: 'proof_execution_failed' })
  })

  test('records leaderboard source calls without correlation IDs in labels', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:telemetry',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 1_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      leaderboardSource: {
        fetchPage: async () => ({ rankings: [], totalPages: 1 }),
      },
    })

    const sourceMetrics = telemetry.metrics.snapshot().find(({ name }) => name === 'source_calls_total')
    expect(sourceMetrics?.series[0]?.labels).toEqual({ domain: 'brawlhalla-v1', outcome: 'succeeded' })
    expect(JSON.stringify(sourceMetrics)).not.toContain(lease.operationId)
  })

  test('waits for leaderboard source admission and resumes without refetching collected pages', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:admission-wait',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 3_600_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 7,
      attemptNumber: 2,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    const reservations: string[] = []
    const waits: number[] = []
    let sourceCalls = 0
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async ({ reservationKey }) => {
          reservations.push(reservationKey)
          return reservations.length === 1
            ? ({ outcome: 'rate-limited', retryAfterSeconds: 12 } as const)
            : ({ outcome: 'admitted', deduplicated: false } as const)
        },
        pauseSource: async () => {},
      },
      waitForSourceAdmission: async (retryAfterMs) => {
        waits.push(retryAfterMs)
      },
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      leaderboardSource: {
        fetchPage: async ({ region }) => {
          sourceCalls += 1
          const id = sourceCalls
          return {
            rankings: [
              {
                identity: { type: 'one-vs-one-player', player: { id, username: `Player ${id}` } },
                rating: 2_100,
                best_rating: 2_100,
                rank: 1,
                wins: 1,
                losses: 0,
                region,
                tier: 'Diamond',
              },
            ],
            totalPages: 1,
          }
        },
      },
    })

    expect(waits).toEqual([12_000])
    expect(sourceCalls).toBe(9)
    expect(reservations[0]).toBe(`${lease.operationId}:7:1v1:US-E:1`)
    expect(reservations[1]).toBe(reservations[0])
  })

  test('retries a transient leaderboard page failure in place through fresh source admission', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:page-retry',
      kind: 'leaderboard-3v3',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 4,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    const reservations: string[] = []
    const retryWaits: number[] = []
    const calls: string[] = []
    let completed = false
    let deferred = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      defer: async () => {
        deferred = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async ({ reservationKey }) => {
          reservations.push(reservationKey)
          return { outcome: 'admitted', deduplicated: false }
        },
        pauseSource: async () => {},
      },
      waitForSourceRetry: async (delayMs) => {
        retryWaits.push(delayMs)
      },
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      leaderboardSource: {
        fetchPage: async ({ region }) => {
          calls.push(region)
          if (region === 'EU' && calls.filter((called) => called === 'EU').length === 1) {
            throw new LeaderboardSourceError('source_transport_failed', 'socket reset', true)
          }
          if (region === 'SEA' && calls.filter((called) => called === 'SEA').length <= 2) {
            throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 504', true)
          }
          const id = calls.length
          return {
            rankings: [
              {
                identity: { type: 'three-vs-three-player', player: { id, username: `Player ${id}` } },
                rating: 2_100,
                best_rating: 2_100,
                rank: 1,
                wins: 1,
                losses: 0,
                region,
                tier: 'Diamond',
              },
            ],
            totalPages: 1,
          }
        },
      },
    })

    expect(completed).toBe(true)
    expect(deferred).toBe(false)
    expect(calls).toHaveLength(12)
    expect(retryWaits).toEqual([500, 500, 2_000])
    expect(reservations).toHaveLength(12)
    expect(new Set(reservations).size).toBe(12)
    expect(reservations).toContain(`${lease.operationId}:4:3v3:EU:1:retry-1`)
    expect(reservations).toContain(`${lease.operationId}:4:3v3:SEA:1:retry-2`)
  })

  test('leaves leaderboard rate limits to durable backoff instead of retrying in place', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:rate-limited',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    let sourceCalls = 0
    let deferred: OperationFailure | undefined
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure) => {
        deferred = failure
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      waitForSourceRetry: async () => {},
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      leaderboardSource: {
        fetchPage: async () => {
          sourceCalls += 1
          throw new LeaderboardSourceError('source_rate_limited', 'V1 leaderboard returned 429', true)
        },
      },
    })

    expect(sourceCalls).toBe(1)
    expect(deferred).toMatchObject({ code: 'source_rate_limited' })
  })

  test('defers retryable leaderboard source outages without consuming the final attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:source-outage',
      kind: 'leaderboard-3v3',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    let deferredMs: number | undefined
    let failed = false
    let sourceCalls = 0
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, _failure: OperationFailure, retryDelayMs: number) => {
        deferredMs = retryDelayMs
        return 'transitioned' as const
      },
      fail: async () => {
        failed = true
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceUnavailableRetryMs: 60_000,
      admission,
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      waitForSourceRetry: async () => {},
      leaderboardSource: {
        fetchPage: async () => {
          sourceCalls += 1
          throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 502', true)
        },
      },
    })

    expect(sourceCalls).toBe(3)
    expect(deferredMs).toBe(60_000)
    expect(failed).toBe(false)
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
    expect(failures?.series[0]?.labels.failure_category).toBe('source_unavailable')
  })

  test('defers inconsistent leaderboard identity without consuming the final attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:inconsistent-team',
      kind: 'leaderboard-2v2',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    let deferred: { failure: OperationFailure; retryDelayMs: number } | undefined
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        deferred = { failure, retryDelayMs }
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceUnavailableRetryMs: 1_000,
      admission,
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      ranking: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      leaderboardSource: {
        fetchPage: async () => {
          throw new LeaderboardSourceError(
            'source_data_inconsistent',
            'rankings[0].players must contain distinct player IDs',
            true,
          )
        },
      },
    })

    expect(deferred).toEqual({
      failure: {
        code: 'source_data_inconsistent',
        message: 'rankings[0].players must contain distinct player IDs',
        retryable: true,
      },
      retryDelayMs: 60_000,
    })
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
    expect(failures?.series[0]?.labels.failure_category).toBe('source_unavailable')
  })

  test('runs recently viewed refreshes in the background without a Primary assignment', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'freshness:42:op',
      kind: 'interactive-player-refresh',
      workClass: 'primary-monitoring',
      payload: { cohort: 'recently-viewed', brawlhallaId: 42, staleSections: ['ranked', 'stats'] },
      provenance: { source: 'freshness-planner' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 4,
      scheduleWindowAt: null,
    }
    const sections: string[] = []
    const callers: string[] = []
    let eligibilityChecked = false
    let completed = false
    await runOneRefreshOperation(
      {
        claim: async () => lease,
        renew: async () => 'renewed' as const,
        beginInteractiveSection: async () => 'execute' as const,
        commitInteractiveSection: async () => 'transitioned' as const,
        complete: async () => {
          completed = true
          return 'transitioned' as const
        },
        fail: async () => 'transitioned' as const,
      } as never,
      'worker',
      {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        sourceAdmission: {
          admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
          pauseSource: async () => {},
        },
        isPrimaryMonitoringTarget: async () => {
          eligibilityChecked = true
          return false
        },
        executeSection: async (_lease, section, admitSourceCall, caller) => {
          sections.push(section)
          callers.push(caller)
          await admitSourceCall('brawlhalla-v0')
        },
      },
    )

    expect(eligibilityChecked).toBe(false)
    expect(sections).toEqual(['ranked', 'stats'])
    expect(callers).toEqual(['background', 'background'])
    expect(completed).toBe(true)
  })

  test('runs full Primary monitoring through background source admission and skips revoked assignments', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'primary-player:42',
      kind: 'interactive-player-refresh',
      workClass: 'primary-monitoring',
      payload: {
        assignmentId: crypto.randomUUID(),
        brawlhallaId: 42,
        staleSections: ['ranked', 'stats'],
      },
      provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: '2026-08-10T00:00:00.000Z',
    }
    const sections: string[] = []
    const callers: string[] = []
    let sourceAdmissions = 0
    let completed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => 'transitioned' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => {
          sourceAdmissions++
          return { outcome: 'admitted', deduplicated: false }
        },
        pauseSource: async () => {},
      },
      isPrimaryMonitoringTarget: async () => true,
      executeSection: async (_lease, section, admitSourceCall, caller) => {
        sections.push(section)
        callers.push(caller)
        await admitSourceCall('brawlhalla-v0')
      },
    })

    expect(sections).toEqual(['ranked', 'stats'])
    expect(callers).toEqual(['background', 'background'])
    expect(sourceAdmissions).toBe(2)
    expect(completed).toBe(true)

    sections.length = 0
    completed = false
    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      isPrimaryMonitoringTarget: async () => false,
      executeSection: async (_lease, section) => {
        sections.push(section)
      },
    })
    expect(sections).toEqual([])
    expect(completed).toBe(true)
  })
  test('executes player projection work through the durable projection class', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'discovery:players:test',
      kind: 'player-discovery-projection',
      workClass: 'projection',
      payload: { batchSize: 100 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let executed = false
    let completed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      executePlayerProjection: async (claimed) => {
        expect(claimed).toBe(lease)
        executed = true
      },
    })

    expect(executed).toBe(true)
    expect(completed).toBe(true)
  })

  test('executes clan projection and owner reconciliation before the leaderboard fallback', async () => {
    const common = {
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      workClass: 'projection' as const,
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const leases: OperationLease[] = [
      {
        ...common,
        operationId: crypto.randomUUID(),
        operationKey: 'discovery:clans:test',
        kind: 'clan-discovery-projection',
        payload: { batchSize: 100 },
      },
      {
        ...common,
        operationId: crypto.randomUUID(),
        operationKey: 'discovery:reconcile:clan',
        kind: 'discovery-reconciliation',
        payload: { owner: 'clan' },
      },
    ]
    const operationIds = leases.map(({ operationId }) => operationId)
    const executed: string[] = []
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
    const operations = {
      claim: async () => leases.shift() ?? null,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    const executors = {
      executeClanProjection: async (lease: Extract<OperationLease, { kind: 'clan-discovery-projection' }>) => {
        executed.push(lease.kind)
      },
      executeDiscoveryReconciliation: async (lease: Extract<OperationLease, { kind: 'discovery-reconciliation' }>) => {
        executed.push(`${lease.kind}:${lease.payload.owner}`)
      },
    }
    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      ...executors,
    })
    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      ...executors,
    })
    await telemetry.flush(50)

    expect(executed).toEqual(['clan-discovery-projection', 'discovery-reconciliation:clan'])
    expect(sink.records.some(({ attributes }) => attributes?.kind === 'clan-discovery-projection')).toBe(true)
    expect(sink.records.some(({ attributes }) => attributes?.kind === 'discovery-reconciliation')).toBe(true)
    const metrics = JSON.stringify(telemetry.metrics.snapshot())
    expect(metrics).toContain('clan-discovery-projection')
    expect(metrics).toContain('discovery-reconciliation')
    for (const operationId of operationIds) expect(metrics).not.toContain(operationId)
  })

  test('retries projection reconciliation failures without consuming the final attempt', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'discovery:players:failed-reconciliation',
      kind: 'player-discovery-projection',
      workClass: 'projection',
      payload: { batchSize: 100 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 1,
      scheduleWindowAt: null,
    }
    let retried = false
    let failed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      retryAppliedDiscoveryProjection: async () => {
        retried = true
        return 'transitioned' as const
      },
      fail: async () => {
        failed = true
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      executePlayerProjection: async () => {
        throw new Error('owner acknowledgment failed')
      },
      playerProjectionEffectState: async () => {
        throw new Error('receipt lookup unavailable')
      },
    })

    expect(retried).toBe(true)
    expect(failed).toBe(false)
  })

  test('defers Statistics source admission without consuming its execution attempt', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'statistics:cohort:42:ranked',
      kind: 'statistics-ranked-collection',
      workClass: 'global-statistics',
      payload: { cohortId: crypto.randomUUID(), brawlhallaId: 42 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let deferredMs: number | undefined
    let failed = false
    let recorded = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, _failure: OperationFailure, retryDelayMs: number) => {
        deferredMs = retryDelayMs
        return 'transitioned' as const
      },
      complete: async () => 'transitioned' as const,
      fail: async () => {
        failed = true
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 37 }),
        pauseSource: async () => {},
      },
      statistics: {
        preflightCollection: async () => 'missing',
        preflightCollectionAttempt: async () => 'allowed',
        recordCollectionAttempt: async () => {
          recorded = true
          return 'recorded'
        },
      } as never,
      executeStatisticsCollection: async () => {
        throw new Error('rate-limited work must not call the source')
      },
    })

    expect(deferredMs).toBe(37_000)
    expect(failed).toBe(false)
    expect(recorded).toBe(false)
  })

  test('consumes an attempt for an upstream Statistics 429 after recording its immutable fence', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'statistics:cohort:43:ranked',
      kind: 'statistics-ranked-collection',
      workClass: 'global-statistics',
      payload: { cohortId: crypto.randomUUID(), brawlhallaId: 43 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let deferred = false
    let failed: { failure: OperationFailure; retryDelayMs: number } | undefined
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async () => {
        deferred = true
        return 'transitioned' as const
      },
      complete: async () => 'transitioned' as const,
      fail: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        failed = { failure, retryDelayMs }
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      statistics: {
        preflightCollection: async () => 'missing',
        preflightCollectionAttempt: async () => 'allowed',
        recordCollectionAttempt: async () => 'recorded',
      } as never,
      executeStatisticsCollection: async () => {
        throw new RateLimitError('Upstream source is rate limited', 37_000)
      },
    })

    expect(failed).toEqual({
      failure: { code: 'source_rate_limited', message: 'Upstream source is rate limited', retryable: true },
      retryDelayMs: 37_000,
    })
    expect(deferred).toBe(false)
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
    expect(failures?.series[0]?.labels.failure_category).toBe('source_rate_limited')
  })

  test('defers clan source admission without consuming its execution attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'clan:77',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 77, staleSections: ['profile'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let deferred: { failure: OperationFailure; retryDelayMs: number } | undefined
    let failed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }) as const,
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => 'transitioned' as const,
      complete: async () => 'transitioned' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        deferred = { failure, retryDelayMs }
        return 'transitioned' as const
      },
      fail: async () => {
        failed = true
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 37 }),
        pauseSource: async () => {},
      },
      syncClanLeaseAuthority: async () => {},
      executeClanSection: async (_lease, _section, admitSourceCall) => {
        await admitSourceCall('brawlhalla-v1')
      },
    })

    expect(deferred).toEqual({
      failure: { code: 'source_rate_limited', message: 'Source admission is rate limited', retryable: true },
      retryDelayMs: 37_000,
    })
    expect(failed).toBe(false)
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
    expect(failures?.series[0]?.labels.failure_category).toBe('admission_deferred')
  })

  test('waits out Brawlhalla maintenance instead of spending attempts and dead-lettering', async () => {
    const lease = (attemptNumber: number): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'player:maintenance',
      kind: 'interactive-player-refresh',
      workClass: 'interactive',
      payload: { brawlhallaId: 42, staleSections: ['ranked'] },
      provenance: { source: 'interactive-api' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber,
      maxAttempts: 3,
      scheduleWindowAt: null,
    })
    const run = async (operationLease: OperationLease, error: Error) => {
      const transitions: Array<{ kind: 'defer' | 'fail'; code: string; retryDelayMs: number }> = []
      const paused: Array<[string, number]> = []
      await runOneRefreshOperation(
        {
          claim: async () => operationLease,
          renew: async () => 'renewed' as const,
          beginInteractiveSection: async () => 'execute' as const,
          commitInteractiveSection: async () => 'transitioned' as const,
          complete: async () => 'transitioned' as const,
          defer: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
            transitions.push({ kind: 'defer', code: failure.code, retryDelayMs })
            return 'transitioned' as const
          },
          fail: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
            transitions.push({ kind: 'fail', code: failure.code, retryDelayMs })
            return 'transitioned' as const
          },
        } as never,
        'worker',
        {
          leaseMs: 1_000,
          retryDelayMs: 10,
          sourceUnavailableRetryMs: 120_000,
          admission,
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
            pauseSource: async (domain, seconds) => {
              paused.push([domain, seconds])
            },
          },
          executeSection: async () => {
            throw error
          },
        },
      )
      return { transitions, paused }
    }
    const unavailable = new BhApiHttpError(
      'Brawlhalla API error: 503 Service Unavailable for /player/42/ranked',
      503,
      'brawlhalla-v0',
    )

    // Even the final attempt waits for the source: deferral does not spend an attempt.
    expect(await run(lease(3), unavailable)).toEqual({
      transitions: [{ kind: 'defer', code: 'source_unavailable', retryDelayMs: 120_000 }],
      paused: [['brawlhalla-v0', 120]],
    })
    expect(
      (await run(lease(1), new Error('Ranked refresh failed', { cause: unavailable }))).transitions[0],
    ).toMatchObject({ kind: 'defer', code: 'source_unavailable' })

    const broken = await run(
      lease(3),
      new BhApiHttpError('Brawlhalla API error: 500 Internal Server Error', 500, 'brawlhalla-v0'),
    )
    expect(broken.transitions[0]?.kind).toBe('fail')
    expect(broken.paused).toEqual([])
  })

  test('revokes active clan authority and skips publication completion after renewal loss', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'clan:renewal-loss',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 79, staleSections: ['profile'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let renewals = 0
    let revoked = false
    let committed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => {
        renewals++
        return renewals === 1
          ? ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) } as const)
          : ({ outcome: 'lease-lost' } as const)
      },
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => {
        committed = true
        return 'transitioned' as const
      },
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      renewEveryMs: 1,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        pauseSource: async () => {},
      },
      syncClanLeaseAuthority: async () => {},
      revokeClanLeaseAuthority: async () => {
        revoked = true
      },
      executeClanSection: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
      },
    })

    expect(revoked).toBe(true)
    expect(committed).toBe(false)
  })

  test('dispatches the fenced Legend Meta publication without treating it as source collection', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'statistics:10000000-0000-4000-8000-000000000001:legend-meta',
      kind: 'statistics-legend-meta-publication',
      workClass: 'global-statistics',
      payload: { generationId: '10000000-0000-4000-8000-000000000001' },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let built = false
    let completed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    expect(
      await runOneRefreshOperation(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        statistics: {
          preflightLegendMetaPublication: async () => 'missing' as const,
          buildAndPublishLegendMeta: async () => {
            built = true
            return { result: 'applied' as const, decision: null }
          },
        } as never,
        executeStatisticsCollection: async () => {
          throw new Error('Legend Meta publication must not call the Statistics source collector')
        },
      }),
    ).toBe(true)
    expect(built).toBe(true)
    expect(completed).toBe(true)
  })

  test('reports Legend Meta execution and lease-loss failures through bounded telemetry', async () => {
    for (const [transition, expectedCategory] of [
      ['transitioned', 'execution'],
      ['lease-lost', 'lease_lost'],
    ] as const) {
      const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
      const lease: OperationLease = {
        operationId: crypto.randomUUID(),
        effectOperationId: crypto.randomUUID(),
        effectCreatedAt: new Date().toISOString(),
        operationKey: `statistics:legend-meta:${transition}`,
        kind: 'statistics-legend-meta-publication',
        workClass: 'global-statistics',
        payload: { generationId: crypto.randomUUID() },
        provenance: { source: 'test' },
        leaseOwner: 'worker',
        leaseToken: 1,
        attemptNumber: 1,
        maxAttempts: 3,
        scheduleWindowAt: null,
      }
      const operations = {
        claim: async () => lease,
        renew: async () => 'renewed' as const,
        fail: async () => transition,
      }

      await runOneRefreshOperation(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
        statistics: {
          preflightLegendMetaPublication: async () => 'missing' as const,
          buildAndPublishLegendMeta: async () => {
            throw new Error('Legend Meta publication failed')
          },
        } as never,
      })

      const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')
      expect(failures?.series[0]?.labels).toEqual({
        kind: 'statistics-legend-meta-publication',
        failure_category: expectedCategory,
      })
      expect(telemetry.stats().seriesDropped).toBe(0)
    }
  })

  test('preserves a genuine section failure when another section is source-limited', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'clan:78',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 78, staleSections: ['profile', 'roster'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let deferred = false
    let failed: { failure: OperationFailure; retryDelayMs: number } | undefined
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }) as const,
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => 'transitioned' as const,
      complete: async () => 'transitioned' as const,
      defer: async () => {
        deferred = true
        return 'transitioned' as const
      },
      fail: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        failed = { failure, retryDelayMs }
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 41 }),
        pauseSource: async () => {},
      },
      syncClanLeaseAuthority: async () => {},
      executeClanSection: async (_lease, section, admitSourceCall) => {
        if (section === 'profile') throw new Error('generic profile failure')
        await admitSourceCall('brawlhalla-v1')
      },
    })

    expect(failed).toEqual({
      failure: { code: 'clan_refresh_failed', message: 'generic profile failure', retryable: true },
      retryDelayMs: 10,
    })
    expect(deferred).toBe(false)
  })

  test('backs off retryable execution failures exponentially so a brief source hiccup is not dead-lettered', async () => {
    const delays: number[] = []
    for (const attemptNumber of [1, 2, 3]) {
      const lease: OperationLease = {
        operationId: crypto.randomUUID(),
        effectOperationId: crypto.randomUUID(),
        effectCreatedAt: new Date().toISOString(),
        operationKey: `proof:backoff:${attemptNumber}`,
        kind: 'proof',
        workClass: 'interactive',
        payload: { value: 'proof' },
        provenance: { source: 'test' },
        leaseOwner: 'worker',
        leaseToken: 1,
        attemptNumber,
        maxAttempts: 4,
        scheduleWindowAt: null,
      }
      await runOneRefreshOperation(
        {
          claim: async () => lease,
          renew: async () => 'renewed' as const,
          fail: async (_lease: OperationLease, _failure: OperationFailure, retryDelayMs: number) => {
            delays.push(retryDelayMs)
            return 'transitioned' as const
          },
        } as never,
        'worker',
        {
          leaseMs: 1_000,
          retryDelayMs: 2_000,
          retryBackoff: { multiplier: 3, maxDelayMs: 15_000, jitterRatio: 0.2, random: () => 0.5 },
          admission,
          executeEffect: async () => {
            throw new Error('Brawlhalla v0 returned 502')
          },
        },
      )
    }

    expect(delays).toEqual([2_000, 6_000, 15_000])
  })

  test('jitters retry delays within the configured ratio and never beyond the maximum', () => {
    const policy = { baseDelayMs: 2_000, multiplier: 3, maxDelayMs: 15_000, jitterRatio: 0.2 }
    expect(retryDelayForAttempt(1, { ...policy, random: () => 0 })).toBe(1_600)
    expect(retryDelayForAttempt(1, { ...policy, random: () => 0.999_999 })).toBe(2_399)
    expect(retryDelayForAttempt(2, { ...policy, random: () => 0 })).toBe(4_800)
    expect(retryDelayForAttempt(3, { ...policy, random: () => 0.999_999 })).toBe(15_000)
    expect(retryDelayForAttempt(20, { ...policy, random: () => 0.5 })).toBe(15_000)
    expect(retryDelayForAttempt(2, { ...policy, multiplier: 1, jitterRatio: 0, random: Math.random })).toBe(2_000)
    let total = 0
    for (let attempt = 1; attempt < 4; attempt++) total += retryDelayForAttempt(attempt, { ...policy, random: () => 1 })
    expect(total).toBeLessThan(30_000)
  })

  test('propagates published leaderboard player names without failing the publication', async () => {
    const leaseFor = (kind: 'leaderboard-1v1' | 'leaderboard-2v2'): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: `leaderboard:names:${kind}`,
      kind,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    })
    const run = async (
      lease: OperationLease,
      published: 'published' | 'already-published' | 'effect-conflict',
      applyLeaderboardNames: (input: {
        observedAt: Date
        players: Array<{ brawlhallaId: number; name: string }>
      }) => Promise<{ changed: number }>,
      applyLeaderboardRanked: (input: {
        observedAt: Date
        players: Array<{ brawlhallaId: number; rating: number }>
      }) => Promise<{ changed: number }> = async () => ({ changed: 0 }),
    ) => {
      let completed = false
      const operations = {
        claim: async () => lease,
        renew: async () => 'renewed' as const,
        complete: async () => {
          completed = true
          return 'transitioned' as const
        },
        fail: async () => 'transitioned' as const,
      }
      await runOneRefreshOperation(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        sourceAdmission: {
          admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
          pauseSource: async () => {},
        },
        ranking: {
          publishGeneration: async () => published,
          recordCollectionFailure: async () => 'recorded' as const,
        },
        leaderboardPlayerNames: { applyLeaderboardNames },
        leaderboardRanked: { applyLeaderboardRanked },
        leaderboardSource: {
          fetchPage: async ({ region }) => {
            const base = (regionIndex.get(region) ?? 0) * 10 + 1
            return {
              rankings: [
                {
                  identity:
                    lease.kind === 'leaderboard-2v2'
                      ? {
                          type: 'fixed-two-vs-two-team',
                          players: [
                            { id: base, username: `First ${base}` },
                            { id: base + 1, username: `Second ${base + 1}` },
                          ],
                        }
                      : { type: 'one-vs-one-player', player: { id: base, username: `Solo ${base}` } },
                  rating: 2_100,
                  best_rating: 2_100,
                  rank: 1,
                  wins: 1,
                  losses: 0,
                  region,
                  tier: 'Diamond',
                },
              ],
              totalPages: 1,
            }
          },
        },
      })
      return completed
    }
    const regionIndex = new Map(['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'].map((r, i) => [r, i]))

    const applied: Array<{ observedAt: Date; players: Array<{ brawlhallaId: number; name: string }> }> = []
    const record = async (input: { observedAt: Date; players: Array<{ brawlhallaId: number; name: string }> }) => {
      applied.push(input)
      return { changed: input.players.length }
    }

    expect(await run(leaseFor('leaderboard-2v2'), 'published', record)).toBe(true)
    expect(applied).toHaveLength(1)
    expect(applied[0].observedAt).toBeInstanceOf(Date)
    expect(applied[0].players).toHaveLength(18)
    expect(applied[0].players).toContainEqual({ brawlhallaId: 1, name: 'First 1' })
    expect(applied[0].players).toContainEqual({ brawlhallaId: 2, name: 'Second 2' })

    expect(await run(leaseFor('leaderboard-1v1'), 'already-published', record)).toBe(true)
    expect(applied).toHaveLength(2)
    expect(applied[1].players).toHaveLength(9)
    expect(applied[1].players).toContainEqual({ brawlhallaId: 81, name: 'Solo 81' })

    await run(leaseFor('leaderboard-1v1'), 'effect-conflict', record)
    expect(applied).toHaveLength(2)

    expect(
      await run(leaseFor('leaderboard-1v1'), 'published', async () => {
        throw new Error('players database unavailable')
      }),
    ).toBe(true)
  })

  test('deep crawls every page of a region and writes standings in chunks without publishing', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'rankings:1v1:deep:AUS:1',
      kind: 'leaderboard-deep-crawl',
      workClass: 'leaderboard',
      payload: { region: 'AUS', intervalMs: 3 * 60 * 60 * 1000 },
      provenance: { source: 'leaderboard-deep-crawl-schedule' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }
    type Progress = { windowAt: Date; nextPage: number; totalPages: number }
    const run = async (
      totalPages: number,
      input: {
        failOnPage?: number
        failure?: LeaderboardSourceError
        slicePages?: number
        saved?: Progress
        pageDelayMs?: number
      } = {},
    ) => {
      const waits: number[] = []
      const fetched: number[] = []
      const nameWrites: number[] = []
      const standingWrites: Array<Array<{ brawlhallaId: number; games: number }>> = []
      const transitions: string[] = []
      let progress: Progress | null = input.saved ?? null
      await runOneRefreshOperation(
        {
          claim: async () => lease,
          renew: async () => 'renewed' as const,
          complete: async () => {
            transitions.push('complete')
            return 'transitioned' as const
          },
          defer: async (_lease: OperationLease, failure: OperationFailure) => {
            transitions.push(`defer:${failure.code}`)
            return 'transitioned' as const
          },
          fail: async (_lease: OperationLease, failure: OperationFailure) => {
            transitions.push(`fail:${failure.code}`)
            return 'transitioned' as const
          },
        } as never,
        'worker',
        {
          leaseMs: 1_000,
          retryDelayMs: 10,
          admission,
          deepCrawlSlicePages: input.slicePages,
          deepCrawlPageDelayMs: input.pageDelayMs,
          waitForSourceRetry: async (delayMs: number) => {
            waits.push(delayMs)
          },
          leaderboardDeepCrawlProgress: {
            read: async () => progress,
            save: async (saved) => {
              progress = { windowAt: saved.windowAt, nextPage: saved.nextPage, totalPages: saved.totalPages }
            },
          },
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
            pauseSource: async () => {},
          },
          ranking: {
            publishGeneration: async () => {
              throw new Error('the deep crawl must not publish a generation')
            },
            recordCollectionFailure: async () => 'recorded' as const,
          },
          leaderboardPlayerNames: {
            applyLeaderboardNames: async ({ players }) => {
              nameWrites.push(players.length)
              return { changed: 0 }
            },
          },
          leaderboardRanked: {
            applyLeaderboardRanked: async ({ players }) => {
              standingWrites.push(players)
              return { changed: players.length }
            },
          },
          leaderboardSource: {
            fetchPage: async ({ mode, region, page }) => {
              expect(mode).toBe('1v1')
              expect(region).toBe('AUS')
              fetched.push(page)
              if (page === input.failOnPage) throw input.failure
              if (totalPages === 0) return { rankings: [], totalPages: 0 }
              return {
                totalPages,
                rankings: [
                  {
                    identity: { type: 'one-vs-one-player', player: { id: page, username: `Player ${page}` } },
                    rating: 1_900,
                    best_rating: 2_000,
                    rank: page,
                    wins: 3,
                    losses: 2,
                    region: 'AUS',
                    tier: 'Platinum 5',
                  },
                ],
              }
            },
          },
        },
      )
      return { fetched, nameWrites, standingWrites, transitions, progress, waits }
    }

    const crawl = await run(45)
    expect(crawl.fetched).toEqual(Array.from({ length: 45 }, (_, index) => index + 1))
    expect(crawl.nameWrites).toEqual([20, 20, 5])
    expect(crawl.standingWrites.map((chunk) => chunk.length)).toEqual([20, 20, 5])
    expect(crawl.standingWrites[0][0]).toEqual({
      brawlhallaId: 1,
      region: 'AUS',
      rating: 1_900,
      peakRating: 2_000,
      tier: 'Platinum 5',
      wins: 3,
      games: 5,
    })
    expect(crawl.transitions).toEqual(['complete'])
    expect(crawl.progress).toMatchObject({ nextPage: 46, totalPages: 45 })

    const empty = await run(0)
    expect(empty).toMatchObject({ fetched: [1], nameWrites: [], transitions: ['complete'] })

    // A malformed deep page is skipped rather than failing the region.
    const skipped = await run(45, {
      failOnPage: 30,
      failure: new LeaderboardSourceError('source_contract_invalid', 'rating exceeds best_rating', false),
    })
    expect(skipped.nameWrites).toEqual([20, 20, 4])
    expect(skipped.transitions).toEqual(['complete'])

    // A leaderboard that shrank mid-crawl ends it.
    const shrank = await run(45, {
      failOnPage: 31,
      failure: new LeaderboardSourceError('source_contract_invalid', 'requested page 31 exceeds total_pages 30', false),
    })
    expect(shrank.fetched.at(-1)).toBe(31)
    expect(shrank.nameWrites).toEqual([20, 10])
    expect(shrank.transitions).toEqual(['complete'])

    // An unavailable source defers; a bad first page still fails.
    const unavailable = await run(45, {
      failOnPage: 3,
      failure: new LeaderboardSourceError('source_unavailable', 'maintenance', true),
    })
    expect(unavailable.transitions).toEqual(['defer:source_unavailable'])
    const badFirst = await run(45, {
      failOnPage: 1,
      failure: new LeaderboardSourceError('source_contract_invalid', 'bad page', false),
    })
    expect(badFirst.transitions).toEqual(['fail:source_contract_invalid'])

    // The page delay paces the crawl between pages, not after the last one.
    const paced = await run(5, { pageDelayMs: 400 })
    expect(paced.waits).toEqual([400, 400, 400, 400])
    expect(paced.transitions).toEqual(['complete'])

    // Slices yield the leaderboard slot and the next attempt resumes where the last chunk stopped.
    const firstSlice = await run(100, { slicePages: 40 })
    expect(firstSlice.fetched).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
    expect(firstSlice.transitions).toEqual(['defer:deep_crawl_yield'])
    expect(firstSlice.progress).toMatchObject({ nextPage: 41, totalPages: 100 })
    const resumed = await run(100, { slicePages: 100, saved: firstSlice.progress as Progress })
    expect(resumed.fetched[0]).toBe(41)
    expect(resumed.fetched).toHaveLength(60)
    expect(resumed.transitions).toEqual(['complete'])
  })

  test('propagates published 1v1 standings without failing the publication', async () => {
    const standings: Array<{ observedAt: Date; players: Array<{ brawlhallaId: number; rating: number }> }> = []
    const recordStandings = async (input: {
      observedAt: Date
      players: Array<{ brawlhallaId: number; rating: number }>
    }) => {
      standings.push(input)
      return { changed: input.players.length }
    }
    const noNames = async () => ({ changed: 0 })
    const lease = (kind: 'leaderboard-1v1' | 'leaderboard-2v2'): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: `leaderboard:standings:${kind}`,
      kind,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    })
    const regionIndex = new Map(['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'].map((r, i) => [r, i]))
    const run = (
      operationLease: OperationLease,
      applyLeaderboardRanked: typeof recordStandings | (() => Promise<never>),
    ) => {
      let completed = false
      return runOneRefreshOperation(
        {
          claim: async () => operationLease,
          renew: async () => 'renewed' as const,
          complete: async () => {
            completed = true
            return 'transitioned' as const
          },
          fail: async () => 'transitioned' as const,
        } as never,
        'worker',
        {
          leaseMs: 1_000,
          retryDelayMs: 10,
          admission,
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
            pauseSource: async () => {},
          },
          ranking: {
            publishGeneration: async () => 'published' as const,
            recordCollectionFailure: async () => 'recorded' as const,
          },
          leaderboardPlayerNames: { applyLeaderboardNames: noNames },
          leaderboardRanked: { applyLeaderboardRanked },
          leaderboardSource: {
            fetchPage: async ({ region }) => {
              const id = (regionIndex.get(region) ?? 0) * 10 + 1
              return {
                rankings: [
                  {
                    identity:
                      operationLease.kind === 'leaderboard-2v2'
                        ? {
                            type: 'fixed-two-vs-two-team',
                            players: [
                              { id, username: `First ${id}` },
                              { id: id + 1, username: `Second ${id + 1}` },
                            ],
                          }
                        : { type: 'one-vs-one-player', player: { id, username: `Solo ${id}` } },
                    rating: 1_973,
                    best_rating: 2_039,
                    rank: 1,
                    wins: 39,
                    losses: 30,
                    region,
                    tier: 'Diamond',
                  },
                ],
                totalPages: 1,
              }
            },
          },
        },
      ).then(() => completed)
    }

    expect(await run(lease('leaderboard-2v2'), recordStandings)).toBe(true)
    expect(standings).toHaveLength(0)

    expect(await run(lease('leaderboard-1v1'), recordStandings)).toBe(true)
    expect(standings).toHaveLength(1)
    expect(standings[0].players).toHaveLength(9)
    expect(standings[0].players).toContainEqual({
      brawlhallaId: 41,
      region: 'AUS',
      rating: 1_973,
      peakRating: 2_039,
      tier: 'Diamond',
      wins: 39,
      games: 69,
    })

    expect(
      await run(lease('leaderboard-1v1'), async () => {
        throw new Error('players database unavailable')
      }),
    ).toBe(true)
  })
})
