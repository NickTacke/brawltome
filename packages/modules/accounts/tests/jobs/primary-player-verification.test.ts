import { describe, expect, test } from 'bun:test'
import type { Lease, OperationFailure, QueueWorker } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createPrimaryPlayerVerificationJob } from '../../jobs/primary-player-verification-job'

const attemptId = '5f689990-dc60-4d70-bd1c-7b49b89786b7'
const evidenceResolver = { resolve: async () => null }

function verificationLease(): Lease<unknown> {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: `primary-player:${attemptId}`,
    kind: 'primary-player-verification',
    workClass: 'interactive',
    payload: { value: attemptId },
    provenance: { source: 'steam-openid' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

const verifyNothing = async () => {}

function createQueueSpy(effectResult: 'applied' | 'effect-conflict' | 'lease-lost' = 'applied') {
  const steps: string[] = []
  const failures: OperationFailure[] = []
  const leases = [verificationLease()]

  const queue = {
    claim: async () => leases.shift() ?? null,
    renew: async () => 'renewed' as const,
    commitProofEffect: async () => {
      steps.push('commit effect')

      return effectResult
    },
    complete: async () => {
      steps.push('complete')

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      failures.push(failure)

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return { queue, steps, failures }
}

function createJob(verify: (attemptId: string, resolver: unknown) => Promise<void>) {
  return createPrimaryPlayerVerificationJob({
    accounts: {
      resolvePrimaryPlayerVerification: async (attempt, resolver) => {
        await verify(attempt, resolver)

        return {} as never
      },
    },
    createEvidenceResolver: () => evidenceResolver,
  })
}

describe('primary player verification job', () => {
  test('runs on the interactive work class and reports the failure code dashboards already read', () => {
    const job = createJob(verifyNothing)

    expect(job.kind).toBe('primary-player-verification')
    expect(job.workClasses).toEqual(['interactive'])
    expect(job.failureCode).toBe('proof_execution_failed')
  })

  test('verifies the attempt with the resolver of this lease, then commits its effect and completes', async () => {
    const verified: Array<[string, unknown]> = []
    const { queue, steps } = createQueueSpy()

    const job = createJob(async (attempt, resolver) => {
      verified.push([attempt, resolver])
      steps.push('verify')
    })

    expect(await runJobOnce(queue, job)).toBe('succeeded')
    expect(verified).toEqual([[attemptId, evidenceResolver]])
    expect(steps).toEqual(['verify', 'commit effect', 'complete'])
  })

  test('fails with proof_execution_failed when verification throws', async () => {
    const { queue, failures, steps } = createQueueSpy()

    const job = createJob(async () => {
      throw new Error('steam lookup failed')
    })

    await runJobOnce(queue, job)

    expect(failures.map(({ code }) => code)).toEqual(['proof_execution_failed'])
    expect(steps).toEqual([])
  })

  test('dead-letters without retrying when the operation key belongs to a different effect', async () => {
    const { queue, failures } = createQueueSpy('effect-conflict')

    expect(await runJobOnce(queue, createJob(verifyNothing))).toBe('dead_letter')

    expect(failures.map(({ code, retryable }) => ({ code, retryable }))).toEqual([
      { code: 'effect_conflict', retryable: false },
    ])
  })

  test('reports a lost lease when the effect write was fenced', async () => {
    const { queue } = createQueueSpy('lease-lost')

    expect(await runJobOnce(queue, createJob(verifyNothing))).toBe('lease_lost')
  })
})
