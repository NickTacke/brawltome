import { describe, expect, test } from 'bun:test'
import type {
  Lease,
  OperationFailure,
  QueueWorker,
  SourceAdmissionPort,
  SourceAdmitter,
} from '@brawltome/refresh-operations'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import { createRankedPlayerPulseJob, type RankedPlayerPulseJobDependencies } from '../../jobs/ranked-player-pulse-job'

function pulseLease(): Lease<unknown> {
  return {
    operationId: 'operation',
    effectOperationId: 'effect',
    effectCreatedAt: new Date().toISOString(),
    operationKey: 'ranked-pulse:42',
    kind: 'ranked-player-pulse',
    workClass: 'primary-monitoring',
    payload: { brawlhallaId: 42 },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

function createQueueSpy(completeResult: 'transitioned' | 'lease-lost' = 'transitioned') {
  const failed: OperationFailure[] = []
  let renewals = 0
  let completions = 0

  const queue = {
    claim: async () => pulseLease(),
    renew: async () => {
      renewals++

      return 'renewed' as const
    },
    complete: async () => {
      completions++

      return completeResult
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      failed.push(failure)

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return { queue, failed, renewals: () => renewals, completions: () => completions }
}

function createDependencies(overrides: Partial<RankedPlayerPulseJobDependencies> = {}) {
  const reservationKeys: string[] = []
  const applied: unknown[] = []

  const sourceAdmission: SourceAdmissionPort = {
    admitSource: async ({ reservationKey }) => {
      reservationKeys.push(reservationKey)

      return { outcome: 'admitted' }
    },
    pauseSource: async () => {},
  }

  const dependencies: RankedPlayerPulseJobDependencies = {
    rankedPlayers: {
      applyPulse: async (pulse: unknown, effect: unknown) => {
        applied.push({ pulse, effect })

        return 'applied'
      },
      recordPulseChecked: async () => 'no-op',
    } as unknown as RankedPlayerPulseJobDependencies['rankedPlayers'],
    createAdmittedPulseSource: (admitSource: SourceAdmitter) => ({
      getOneVsOne: async (_brawlhallaId, options) => {
        await admitSource('brawlhalla-v1')
        options.onAttempt()

        return { brawlhalla_id: 42, rating: 1750, games: 14 }
      },
      getFixedTeams: async () => null,
    }),
    ...overrides,
  }

  return { dependencies, reservationKeys, applied, sourceAdmission }
}

describe('ranked player pulse job', () => {
  test('admits calls under the ranked-pulse section and completes', async () => {
    const { queue, renewals, completions } = createQueueSpy()
    const { dependencies, reservationKeys, sourceAdmission } = createDependencies()

    expect(
      await runJobOnce(queue, createRankedPlayerPulseJob(dependencies), {
        leaseMs: 1_000,
        retryDelayMs: 10,
        sourceAdmission,
        renewEveryMs: 60_000,
      }),
    ).toBe('succeeded')

    expect(reservationKeys).toEqual(['operation:ranked-pulse:1:0'])
    expect(renewals()).toBe(0)
    expect(completions()).toBe(1)
  })

  test('passes the lease to the pulse as its effect', async () => {
    const { queue } = createQueueSpy()
    const { dependencies, applied, sourceAdmission } = createDependencies()

    await runJobOnce(queue, createRankedPlayerPulseJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission,
      renewEveryMs: 60_000,
    })

    expect(applied[0]).toMatchObject({
      effect: {
        operationId: 'operation',
        effectOperationId: 'effect',
        leaseOwner: 'worker',
        leaseToken: 1,
        section: 'ranked',
      },
    })
  })

  test('reports a lost lease when completing fails', async () => {
    const { queue } = createQueueSpy('lease-lost')
    const { dependencies, sourceAdmission } = createDependencies()

    expect(
      await runJobOnce(queue, createRankedPlayerPulseJob(dependencies), {
        leaseMs: 1_000,
        retryDelayMs: 10,
        sourceAdmission,
        renewEveryMs: 60_000,
      }),
    ).toBe('lease_lost')
  })

  test('fails with its own code when the pulse throws a plain error', async () => {
    const { queue, failed } = createQueueSpy()

    const { dependencies, sourceAdmission } = createDependencies({
      createAdmittedPulseSource: () => {
        throw new Error('execution failed')
      },
    })

    await runJobOnce(queue, createRankedPlayerPulseJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission,
      renewEveryMs: 60_000,
    })

    expect(failed.map(({ code }) => code)).toEqual(['ranked_player_pulse_failed'])
  })

  test('declares its kind, work class and effect check', () => {
    const job = createRankedPlayerPulseJob(createDependencies().dependencies)

    expect(job.kind).toBe('ranked-player-pulse')
    expect(job.workClasses).toEqual(['primary-monitoring'])
    expect(job.effectState).toBeDefined()
  })
})
