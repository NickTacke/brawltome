import { describe, expect, test } from 'bun:test'
import type { Lease, OperationFailure, QueueWorker, SourceAdmissionPort, SourceAdmitter } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import {
  createInteractivePlayerRefreshJob,
  type InteractivePlayerRefreshJobDependencies,
  type InteractivePlayerRefreshPayload,
} from '../../jobs/interactive-player-refresh-job'

const rankedSnapshot = {
  name: 'Primary Ada',
  brawlhalla_id: 42,
  rating: 1700,
  peak_rating: 1750,
  tier: 'Platinum 1',
  wins: 20,
  games: 40,
  region: 'US-E',
  global_rank: 100,
  region_rank: 20,
  legends: [],
  '2v2': [],
}

const careerSnapshot = {
  brawlhalla_id: 42,
  name: 'Primary Ada',
  xp: 100,
  level: 2,
  xp_percentage: 0.5,
  games: 40,
  wins: 20,
  damagebomb: '0',
  damagemine: '0',
  damagespikeball: '0',
  damagesidekick: '0',
  hitsnowball: 0,
  kobomb: 0,
  komine: 0,
  kospikeball: 0,
  kosidekick: 0,
  kosnowball: 0,
  legends: [],
}

function refreshLease(
  workClass: 'interactive' | 'primary-monitoring',
  payload: InteractivePlayerRefreshPayload,
  attemptNumber = 1,
): Lease<unknown> {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: 'player:42',
    kind: 'interactive-player-refresh',
    workClass,
    payload,
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

function createQueueSpy(lease: Lease<unknown>, overrides: Partial<Record<keyof QueueWorker, unknown>> = {}) {
  const committed: string[] = []
  const deferred: { failure: OperationFailure; retryDelayMs: number }[] = []
  const failed: { failure: OperationFailure; retryDelayMs: number }[] = []
  let completions = 0

  const queue = {
    claim: async () => lease,
    renew: async () => 'renewed' as const,
    beginInteractiveSection: async () => 'execute' as const,
    commitInteractiveSection: async (_lease: Lease<unknown>, section: string) => {
      committed.push(section)

      return 'transitioned' as const
    },
    complete: async () => {
      completions++

      return 'transitioned' as const
    },
    defer: async (_lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number) => {
      deferred.push({ failure, retryDelayMs })

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number) => {
      failed.push({ failure, retryDelayMs })

      return 'transitioned' as const
    },
    ...overrides,
  } as unknown as QueueWorker

  return { queue, committed, deferred, failed, completions: () => completions }
}

function admittingSourcePort(paused: Array<[string, number]> = []): SourceAdmissionPort {
  return {
    admitSource: async () => ({ outcome: 'admitted' }),
    pauseSource: async (domain, seconds) => {
      paused.push([domain, seconds])
    },
  }
}

type SourceRecord = {
  callers: string[]
  sections: string[]
  domains: string[]
}

function createDependencies(overrides: Partial<InteractivePlayerRefreshJobDependencies> = {}) {
  const record: SourceRecord = { callers: [], sections: [], domains: [] }

  const dependencies: InteractivePlayerRefreshJobDependencies = {
    rankedPlayers: {
      applySnapshot: async () => 'applied',
      recordChecked: async () => 'no-op',
    } as unknown as InteractivePlayerRefreshJobDependencies['rankedPlayers'],
    careerPlayers: {
      applySnapshot: async () => 'applied',
      recordChecked: async () => 'no-op',
    } as unknown as InteractivePlayerRefreshJobDependencies['careerPlayers'],
    createAdmittedSource: (admitSource: SourceAdmitter) => ({
      getRanked: async (_brawlhallaId, options) => {
        record.sections.push('ranked')
        record.callers.push(options.caller)
        await admitSource('brawlhalla-v0')
        record.domains.push('brawlhalla-v0')
        options.onAttempt()

        return rankedSnapshot
      },
      getStats: async (_brawlhallaId, options) => {
        record.sections.push('stats')
        record.callers.push(options.caller)
        await admitSource('brawlhalla-v0')
        record.domains.push('brawlhalla-v0')
        options.onAttempt()

        return careerSnapshot
      },
    }),
    isPrimaryMonitoringTarget: async () => true,
    resolveLegendReference: () => null,
    ...overrides,
  }

  return { dependencies, record }
}

describe('interactive player refresh job', () => {
  test('runs recently viewed refreshes in the background without a Primary assignment', async () => {
    const lease = refreshLease('primary-monitoring', {
      cohort: 'recently-viewed',
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
    })

    const { queue, completions } = createQueueSpy(lease)
    let eligibilityChecked = false

    const { dependencies, record } = createDependencies({
      isPrimaryMonitoringTarget: async () => {
        eligibilityChecked = true

        return false
      },
    })

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(eligibilityChecked).toBe(false)
    expect(record.sections).toEqual(['ranked', 'stats'])
    expect(record.callers).toEqual(['background', 'background'])
    expect(completions()).toBe(1)
  })

  test('runs full Primary monitoring through background source admission and skips revoked assignments', async () => {
    const assignmentId = crypto.randomUUID()

    const lease = refreshLease('primary-monitoring', {
      assignmentId,
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
    })

    const targetChecks: Array<[string, number]> = []
    let sourceAdmissions = 0

    const current = createQueueSpy(lease)

    const { dependencies: currentDependencies, record: currentRecord } = createDependencies({
      isPrimaryMonitoringTarget: async (id, brawlhallaId) => {
        targetChecks.push([id, brawlhallaId])

        return true
      },
    })

    await runJobOnce(current.queue, createInteractivePlayerRefreshJob(currentDependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: {
        admitSource: async () => {
          sourceAdmissions++

          return { outcome: 'admitted' }
        },
        pauseSource: async () => {},
      },
    })

    expect(currentRecord.sections).toEqual(['ranked', 'stats'])
    expect(currentRecord.callers).toEqual(['background', 'background'])
    expect(sourceAdmissions).toBe(2)
    expect(current.completions()).toBe(1)
    expect(targetChecks[0]).toEqual([assignmentId, 42])

    const revoked = createQueueSpy(lease)
    const { dependencies, record } = createDependencies({ isPrimaryMonitoringTarget: async () => false })

    await runJobOnce(revoked.queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(record.sections).toEqual([])
    expect(revoked.completions()).toBe(1)
  })

  test('stops a section at the first upstream call when the assignment ended mid-refresh', async () => {
    const lease = refreshLease('primary-monitoring', {
      assignmentId: crypto.randomUUID(),
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
    })

    const { queue, failed, committed, completions } = createQueueSpy(lease)
    let targetChecks = 0

    const { dependencies, record } = createDependencies({
      isPrimaryMonitoringTarget: async () => {
        targetChecks++

        // the assignment is still current before the section, then ended before its first call
        return targetChecks === 1
      },
    })

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(committed).toEqual([])
    expect(record.domains).toEqual([])
    expect(failed).toEqual([])
    expect(completions()).toBe(1)
  })

  test('fails the attempt when the assignment ends inside the last section', async () => {
    const lease = refreshLease('primary-monitoring', {
      assignmentId: crypto.randomUUID(),
      brawlhallaId: 42,
      staleSections: ['ranked', 'stats'],
    })

    const { queue, failed, committed } = createQueueSpy(lease)
    let targetChecks = 0

    const { dependencies } = createDependencies({
      isPrimaryMonitoringTarget: async () => {
        targetChecks++

        // current for ranked's two checks and the stats pre-check, then ended before stats calls upstream
        return targetChecks <= 3
      },
    })

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(committed).toEqual(['ranked'])
    expect(failed.map(({ failure }) => failure.message)).toEqual(['Primary Player assignment is no longer current'])
  })

  test('runs an interactive refresh on demand, section by section', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked', 'stats'] })
    const { queue, committed, completions } = createQueueSpy(lease)
    const { dependencies, record } = createDependencies()

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(record.callers).toEqual(['on-demand', 'on-demand'])
    expect(committed).toEqual(['ranked', 'stats'])
    expect(completions()).toBe(1)
  })

  test('skips a section committed by an earlier attempt', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked', 'stats'] })

    const { queue, committed } = createQueueSpy(lease, {
      beginInteractiveSection: async (_lease: Lease<unknown>, section: string) =>
        section === 'ranked' ? 'already-applied' : 'execute',
    })

    const { dependencies, record } = createDependencies()

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(record.sections).toEqual(['stats'])
    expect(committed).toEqual(['stats'])
  })

  test('a lost renewal stops the refresh and does not commit', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked'] })

    const { queue, committed, completions } = createQueueSpy(lease, {
      renew: async () => 'lease-lost' as const,
    })

    const { dependencies, record } = createDependencies()

    const outcome = await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(outcome).toBe('lease_lost')
    expect(record.sections).toEqual([])
    expect(committed).toEqual([])
    expect(completions()).toBe(0)
  })

  test('a renewal lost mid-section does not commit', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked'] })
    let sectionStarted = false

    const { queue, committed, completions } = createQueueSpy(lease, {
      renew: async () => (sectionStarted ? ('lease-lost' as const) : ('renewed' as const)),
    })

    const { dependencies } = createDependencies({
      createAdmittedSource: () => ({
        // the store would accept the snapshot, so only the lost lease can keep this from committing
        getRanked: async () => {
          sectionStarted = true
          await new Promise((resolve) => setTimeout(resolve, 30))

          return rankedSnapshot
        },
        getStats: async () => careerSnapshot,
      }),
    })

    const outcome = await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      renewEveryMs: 1,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(outcome).toBe('lease_lost')
    expect(committed).toEqual([])
    expect(completions()).toBe(0)
  })

  test('hands the legend resolver to the career section', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['stats'] })
    const { queue } = createQueueSpy(lease)
    const resolvedLegends: Array<[number, string]> = []

    const { dependencies } = createDependencies({
      createAdmittedSource: () => ({
        getRanked: async () => rankedSnapshot,
        getStats: async () => ({
          ...careerSnapshot,
          legends: [
            {
              legend_id: 3,
              legend_name_key: 'bodvar',
              xp: 100,
              level: 2,
              xp_percentage: 0,
              games: 10,
              wins: 4,
              matchtime: 600,
              kos: 20,
              falls: 15,
              suicides: 0,
              teamkos: 1,
              damagedealt: '1',
              damagetaken: '1',
              damageunarmed: '1',
              damagethrownitem: '1',
              damagegadgets: '1',
              kounarmed: 2,
              kothrownitem: 1,
              kogadgets: 0,
              damageweaponone: '1',
              damageweapontwo: '1',
              koweaponone: 1,
              koweapontwo: 1,
              timeheldweaponone: 1,
              timeheldweapontwo: 1,
            },
          ],
        }),
      }),
      resolveLegendReference: (legendId, legendNameKey) => {
        resolvedLegends.push([legendId, legendNameKey])

        return { legendId: 3, legendNameKey: 'bodvar', weaponOne: 'Hammer', weaponTwo: 'Sword' }
      },
    })

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(resolvedLegends).toEqual([[3, 'bodvar']])
  })

  test('fails with its own code when a section throws a plain error', async () => {
    const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked'] })
    const { queue, failed } = createQueueSpy(lease)

    const { dependencies } = createDependencies({
      rankedPlayers: {
        applySnapshot: async () => {
          throw new Error('execution failed')
        },
        recordChecked: async () => 'no-op',
      } as unknown as InteractivePlayerRefreshJobDependencies['rankedPlayers'],
    })

    await runJobOnce(queue, createInteractivePlayerRefreshJob(dependencies), {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: admittingSourcePort(),
    })

    expect(failed.map(({ failure }) => failure.code)).toEqual(['interactive_player_refresh_failed'])
  })

  test('waits out Brawlhalla maintenance instead of spending attempts and dead-lettering', async () => {
    class SourceHttpError extends Error {
      constructor(
        message: string,
        readonly status: number,
        readonly domain: string,
      ) {
        super(message)
      }
    }

    const run = async (attemptNumber: number, error: Error) => {
      const lease = refreshLease('interactive', { brawlhallaId: 42, staleSections: ['ranked'] }, attemptNumber)
      const spy = createQueueSpy(lease)
      const paused: Array<[string, number]> = []

      const { dependencies } = createDependencies({
        createAdmittedSource: () => ({
          getRanked: async () => {
            throw error
          },
          getStats: async () => careerSnapshot,
        }),
      })

      await runJobOnce(spy.queue, createInteractivePlayerRefreshJob(dependencies), {
        leaseMs: 1_000,
        retryDelayMs: 10,
        sourceUnavailableRetryMs: 120_000,
        sourceAdmission: admittingSourcePort(paused),
      })

      const transitions = [
        ...spy.deferred.map(({ failure, retryDelayMs }) => ({ kind: 'defer', code: failure.code, retryDelayMs })),
        ...spy.failed.map(({ failure, retryDelayMs }) => ({ kind: 'fail', code: failure.code, retryDelayMs })),
      ]

      return { transitions, paused }
    }

    const unavailable = new SourceHttpError(
      'Brawlhalla API error: 503 Service Unavailable for /player/42/ranked',
      503,
      'brawlhalla-v0',
    )

    // even the final attempt waits for the source: deferral does not spend an attempt
    expect(await run(3, unavailable)).toEqual({
      transitions: [{ kind: 'defer', code: 'source_unavailable', retryDelayMs: 120_000 }],
      paused: [['brawlhalla-v0', 120]],
    })

    expect((await run(1, new Error('Ranked refresh failed', { cause: unavailable }))).transitions[0]).toMatchObject({
      kind: 'defer',
      code: 'source_unavailable',
    })

    const broken = await run(
      3,
      new SourceHttpError('Brawlhalla API error: 500 Internal Server Error', 500, 'brawlhalla-v0'),
    )

    expect(broken.transitions[0]?.kind).toBe('fail')
    expect(broken.paused).toEqual([])
  })

  test('declares its kind, work classes, failure code and effect check', async () => {
    const { dependencies } = createDependencies()
    const job = createInteractivePlayerRefreshJob(dependencies)

    expect(job.kind).toBe('interactive-player-refresh')
    expect(job.workClasses).toEqual(['interactive', 'primary-monitoring'])
    expect(job.failureCode).toBe('interactive_player_refresh_failed')
    expect(job.effectState).toBeDefined()
  })
})
