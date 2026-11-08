import { describe, expect, test } from 'bun:test'
import type { Lease, OperationFailure, QueueWorker, SourceAdmissionPort } from '@brawltome/refresh-operations'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import {
  createPlayerNameVerificationJob,
  type PlayerNameVerificationPayload,
} from '../../jobs/player-name-verification-job'

function verificationLease(): Lease<unknown> {
  return {
    operationId: 'operation',
    effectOperationId: 'effect',
    effectCreatedAt: new Date().toISOString(),
    operationKey: 'player-name-verification:42',
    kind: 'player-name-verification',
    workClass: 'maintenance',
    payload: { brawlhallaId: 42, playerName: 'Ada' },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

function createQueueSpy(renewal: 'renewed' | 'lease-lost' = 'renewed') {
  const failed: OperationFailure[] = []
  const steps: string[] = []

  const queue = {
    claim: async () => verificationLease(),
    renew: async () => {
      steps.push('renew')

      return renewal
    },
    complete: async () => {
      steps.push('complete')

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      failed.push(failure)

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return { queue, failed, steps }
}

const admittingSource: SourceAdmissionPort = {
  admitSource: async () => ({ outcome: 'admitted' }),
  pauseSource: async () => {},
}

describe('player name verification job', () => {
  test('renews before verifying, then completes', async () => {
    const { queue, steps } = createQueueSpy()
    const reservationKeys: string[] = []

    const job = createPlayerNameVerificationJob({
      verifyName: async (lease, admitSource) => {
        steps.push(`verify ${(lease.payload as PlayerNameVerificationPayload).brawlhallaId}`)
        await admitSource('brawlhalla-v0')
      },
    })

    const outcome = await runJobOnce(queue, job, {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: {
        admitSource: async ({ reservationKey }) => {
          reservationKeys.push(reservationKey)

          return { outcome: 'admitted' }
        },
        pauseSource: async () => {},
      },
    })

    expect(outcome).toBe('succeeded')
    expect(steps).toEqual(['renew', 'verify 42', 'complete'])
    expect(reservationKeys).toEqual(['operation:name-verification:1:0'])
  })

  test('skips the verification when the lease is already lost', async () => {
    const { queue, steps } = createQueueSpy('lease-lost')
    let verifications = 0

    const job = createPlayerNameVerificationJob({
      verifyName: async () => {
        verifications++
      },
    })

    expect(await runJobOnce(queue, job, { leaseMs: 1_000, retryDelayMs: 10, sourceAdmission: admittingSource })).toBe(
      'lease_lost',
    )

    expect(verifications).toBe(0)
    expect(steps).toEqual(['renew'])
  })

  test('fails with its own code when verification throws a plain error', async () => {
    const { queue, failed } = createQueueSpy()

    const job = createPlayerNameVerificationJob({
      verifyName: async () => {
        throw new Error('execution failed')
      },
    })

    await runJobOnce(queue, job, { leaseMs: 1_000, retryDelayMs: 10, sourceAdmission: admittingSource })

    expect(failed.map(({ code }) => code)).toEqual(['player_name_verification_failed'])
  })

  test('reads the ranked section on an expired lease', () => {
    const job = createPlayerNameVerificationJob({ verifyName: async () => {} })

    expect(job.kind).toBe('player-name-verification')
    expect(job.workClasses).toEqual(['maintenance'])
    expect(job.effectState).toBeDefined()
  })
})
