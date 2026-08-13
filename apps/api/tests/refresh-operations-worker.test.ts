import { describe, expect, test } from 'bun:test'
import { RateLimitError } from '@brawltome/bhapi'
import { LeaderboardSourceError } from '@brawltome/ranking/composition'
import type { AdmissionConfig, OperationFailure, OperationLease } from '@brawltome/refresh-operations'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

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
      leaderboardSource: {
        fetchPage: async () => {
          throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 502', true)
        },
      },
    })

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
})
