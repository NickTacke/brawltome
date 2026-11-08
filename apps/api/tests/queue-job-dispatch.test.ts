import { describe, expect, test } from 'bun:test'
import { LeaderboardSourceError } from '@brawltome/ranking'
import {
  type AdmissionConfig,
  type OperationFailure,
  type OperationLease,
  retryDelayForAttempt,
} from '@brawltome/refresh-operations'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createProofJob, runOneWithJobs } from './fixtures/queue'

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
      await runOneWithJobs(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
        jobs: [createProofJob()],
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

    await runOneWithJobs(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry: failingTelemetry,
      jobs: [createProofJob()],
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

    await runOneWithJobs(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      telemetry,
      jobs: [
        createProofJob(async () => {
          throw new Error('execution failed')
        }),
      ],
    })

    const attempts = telemetry.metrics.snapshot().find(({ name }) => name === 'operation_attempts_total')

    expect(attempts?.series[0]?.labels.outcome).toBe('lease_lost')
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(failures?.series[0]?.labels.failure_category).toBe('lease_lost')
  })

  test('still reports the attempt as a retry when recording the failure rejects', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'proof:failure-write-rejected',
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
      fail: async () => {
        throw new Error('connection lost')
      },
    }

    await expect(
      runOneWithJobs(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
        jobs: [
          createProofJob(async () => {
            throw new Error('execution failed')
          }),
        ],
      }),
    ).rejects.toThrow('connection lost')

    const attempts = telemetry.metrics.snapshot().find(({ name }) => name === 'operation_attempts_total')
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(attempts?.series[0]?.labels.outcome).toBe('retry')
    expect(failures?.series[0]?.labels.failure_category).toBe('execution')
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

      await runOneWithJobs(operations as never, 'worker', {
        leaseMs: 1_000,
        retryDelayMs: 10,
        admission,
        telemetry,
        jobs: [
          createProofJob(async () => {
            throw error
          }),
        ],
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

      await runOneWithJobs(
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
          jobs: [
            createProofJob(async () => {
              throw new Error('Brawlhalla v0 returned 502')
            }),
          ],
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
})

function proofLeaseOf(operationKey: string): OperationLease {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey,
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
}

async function explode(): Promise<never> {
  throw new Error('execution failed')
}

describe('refresh operations worker failure handling', () => {
  test('proof fails with proof_execution_failed', async () => {
    const lease = proofLeaseOf('proof:failure-code')
    const failures: OperationFailure[] = []

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      fail: async (_lease: OperationLease, failure: OperationFailure) => {
        failures.push(failure)

        return 'transitioned' as const
      },
    }

    await runOneWithJobs(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      jobs: [createProofJob(explode)],
    })

    expect(failures.map(({ code }) => code)).toEqual(['proof_execution_failed'])
  })
})

describe('refresh operations worker claim latency', () => {
  test('records how long a claim took, labelled by whether it found work', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const claims = [proofLeaseOf('proof:claim-latency'), null]

    const operations = {
      claim: async () => claims.shift() ?? null,
      renew: async () => 'renewed' as const,
      commitProofEffect: async () => 'applied' as const,
      complete: async () => 'transitioned' as const,
    }

    const options = { leaseMs: 1_000, retryDelayMs: 10, admission, telemetry, jobs: [createProofJob()] }

    expect(await runOneWithJobs(operations as never, 'worker', options)).toBe(true)
    expect(await runOneWithJobs(operations as never, 'worker', options)).toBe(false)

    const claimLatency = telemetry.metrics.snapshot().find(({ name }) => name === 'operation_claim_duration_ms')
    const series = claimLatency?.series.map(({ labels, count }) => ({ labels, count }))

    expect(series).toHaveLength(2)
    expect(series).toContainEqual({ labels: { outcome: 'claimed' }, count: 1 })
    expect(series).toContainEqual({ labels: { outcome: 'empty' }, count: 1 })
  })
})
