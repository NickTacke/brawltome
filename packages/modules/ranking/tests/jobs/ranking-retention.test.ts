import { describe, expect, test } from 'bun:test'
import type { Lease, OperationFailure, QueueWorker } from '@brawltome/refresh-operations'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createRankingRetentionJob } from '../../jobs/ranking-retention-job'
import type { RankingRetentionStore } from '../../retention'

function retentionLease(): Lease<unknown> {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: 'ranking-retention:failure-code',
    kind: 'ranking-retention',
    workClass: 'maintenance',
    payload: { retentionHours: 48, maxGenerations: 10 },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

function createQueueSpy() {
  const failures: OperationFailure[] = []
  let completions = 0

  const queue = {
    claim: async () => retentionLease(),
    renew: async () => 'renewed' as const,
    complete: async () => {
      completions++

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      failures.push(failure)

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return { queue, failures, completions: () => completions }
}

function createTestTelemetry() {
  const sink = createMemorySink()

  return { sink, telemetry: createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 }) }
}

describe('ranking retention job', () => {
  test('fails with ranking_retention_failed when the store throws', async () => {
    const { queue, failures } = createQueueSpy()
    const { telemetry } = createTestTelemetry()

    const store: RankingRetentionStore = {
      expireGenerations: async () => {
        throw new Error('execution failed')
      },
    }

    const job = createRankingRetentionJob({ store, isEnabled: true, telemetry })

    await runJobOnce(queue, job)

    expect(failures.map(({ code }) => code)).toEqual(['ranking_retention_failed'])
    await telemetry.shutdown(50)
  })

  test('completes without touching the store when retention is disabled', async () => {
    const { queue, failures, completions } = createQueueSpy()
    const { sink, telemetry } = createTestTelemetry()
    let storeCalls = 0

    const store: RankingRetentionStore = {
      expireGenerations: async () => {
        storeCalls++

        return { outcome: 'completed', deletedGenerations: 0, expirableGenerations: 0 }
      },
    }

    const job = createRankingRetentionJob({ store, isEnabled: false, telemetry })

    expect(await runJobOnce(queue, job)).toBe('succeeded')
    await telemetry.flush(50)

    expect(storeCalls).toBe(0)
    expect(completions()).toBe(1)
    expect(failures).toEqual([])

    expect(sink.records.find(({ event }) => event === 'ranking.retention.skipped')?.attributes).toMatchObject({
      reason: 'disabled',
      deletedGenerations: 0,
    })

    await telemetry.shutdown(50)
  })

  test('reports lease_lost when the store reports the lease lost', async () => {
    const { queue, failures } = createQueueSpy()
    const { telemetry } = createTestTelemetry()
    const store: RankingRetentionStore = { expireGenerations: async () => ({ outcome: 'lease-lost' }) }
    const job = createRankingRetentionJob({ store, isEnabled: true, telemetry })

    expect(await runJobOnce(queue, job)).toBe('lease_lost')
    expect(failures).toEqual([])
    await telemetry.shutdown(50)
  })
})
