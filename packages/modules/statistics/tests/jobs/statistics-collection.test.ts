import { describe, expect, test } from 'bun:test'
import type { OperationFailure } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import type { StatisticsTracer } from '../../index'
import {
  createStatisticsLifetimeCollectionJob,
  createStatisticsRankedCollectionJob,
  type StatisticsCollectionJobDependencies,
} from '../../jobs/statistics-collection-job'
import { createQueueSpy, statisticsLease } from './job-fixtures'

const rankedPayload = { cohortId: '10000000-0000-4000-8000-000000000001', brawlhallaId: 42 }

function rankedLease() {
  return statisticsLease('statistics-ranked-collection', rankedPayload)
}

type StatisticsStub = Partial<StatisticsCollectionJobDependencies['statistics']>

function dependencies(
  statistics: StatisticsStub = {},
  overrides: Partial<StatisticsCollectionJobDependencies> = {},
): StatisticsCollectionJobDependencies {
  return {
    statistics: {
      preflightCollection: async () => 'missing',
      preflightCollectionAttempt: async () => 'allowed',
      recordCollectionAttempt: async () => 'recorded',
      commitObservation: async () => 'applied',
      ...statistics,
    } as StatisticsCollectionJobDependencies['statistics'],
    sourceAdmission: { admitSource: async () => ({ outcome: 'admitted' }) },
    collectEvidence: async () => ({}) as never,
    collectionPace: { waitMsForTurn: () => 0 },
    retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 60_000 },
    ...overrides,
  }
}

const explode = async () => {
  throw new Error('execution failed')
}

function shouldNotRun(what: string) {
  return async (): Promise<never> => {
    throw new Error(`${what} must not run`)
  }
}

const noPause = { pauseSource: async () => {} }

describe('statistics collection job', () => {
  test('defers Statistics source admission without consuming its execution attempt', async () => {
    const spy = createQueueSpy({ ...rankedLease(), attemptNumber: 3 })

    let recorded = false

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {
          recordCollectionAttempt: async () => {
            recorded = true

            return 'recorded'
          },
        },
        {
          sourceAdmission: { admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 37 }) },
          collectEvidence: shouldNotRun('rate-limited source work'),
        },
      ),
    )

    await runJobOnce(spy.queue as never, job, {
      retryDelayMs: 10,
      sourceAdmission: { admitSource: shouldNotRun('the dispatcher admission'), ...noPause },
    })

    expect(spy.deferrals.map(({ retryDelayMs }) => retryDelayMs)).toEqual([37_000])
    expect(spy.failures).toEqual([])
    expect(recorded).toBe(false)
  })

  test('defers until its turn without admitting or recording, so the worker slot is free while it waits', async () => {
    const spy = createQueueSpy(rankedLease())
    let recorded = false

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {
          recordCollectionAttempt: async () => {
            recorded = true

            return 'recorded'
          },
        },
        {
          collectionPace: { waitMsForTurn: () => 4_200 },
          sourceAdmission: { admitSource: shouldNotRun('source admission') },
          collectEvidence: shouldNotRun('the source call'),
        },
      ),
    )

    await runJobOnce(spy.queue as never, job, { retryDelayMs: 10 })

    expect(spy.deferrals.map(({ retryDelayMs }) => retryDelayMs)).toEqual([5_000])
    expect(spy.failures).toEqual([])
    expect(recorded).toBe(false)
  })

  test('consumes an attempt for an upstream Statistics 429 after recording its immutable fence', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const spy = createQueueSpy(rankedLease())

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {},
        {
          collectEvidence: async () => {
            throw Object.assign(new Error('Upstream source is rate limited'), { retryAfterMs: 37_000 })
          },
        },
      ),
    )

    await runJobOnce(spy.queue as never, job, { retryDelayMs: 10, telemetry })

    expect(spy.failures).toEqual([
      {
        failure: { code: 'source_rate_limited', message: 'Upstream source is rate limited', retryable: true },
        retryDelayMs: 37_000,
      },
    ])

    expect(spy.deferrals).toEqual([])
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(failures?.series[0]?.labels.failure_category).toBe('source_rate_limited')
  })

  test('commits ranked and lifetime evidence under their own kind', async () => {
    const commits: unknown[] = []

    const statistics: StatisticsStub = {
      commitObservation: (async (observation: unknown) => {
        commits.push(observation)

        return 'applied'
      }) as StatisticsTracer['commitObservation'],
    }

    const collected: string[] = []

    const collectEvidence: StatisticsCollectionJobDependencies['collectEvidence'] = async (lease) => {
      collected.push(lease.kind)

      return { evidenceFor: lease.kind } as never
    }

    const rankedSpy = createQueueSpy(rankedLease())
    const lifetimeSpy = createQueueSpy(statisticsLease('statistics-lifetime-collection', rankedPayload))

    expect(
      await runJobOnce(
        rankedSpy.queue as never,
        createStatisticsRankedCollectionJob(dependencies(statistics, { collectEvidence })),
      ),
    ).toBe('succeeded')

    expect(
      await runJobOnce(
        lifetimeSpy.queue as never,
        createStatisticsLifetimeCollectionJob(dependencies(statistics, { collectEvidence })),
      ),
    ).toBe('succeeded')

    expect(collected).toEqual(['statistics-ranked-collection', 'statistics-lifetime-collection'])

    expect(commits).toMatchObject([
      {
        authorization: { kind: 'statistics-ranked-collection', cohortId: rankedPayload.cohortId, brawlhallaId: 42 },
        evidence: { evidenceFor: 'statistics-ranked-collection' },
      },
      {
        authorization: { kind: 'statistics-lifetime-collection' },
        evidence: { evidenceFor: 'statistics-lifetime-collection' },
      },
    ])

    expect(rankedSpy.completions()).toBe(1)
    expect(lifetimeSpy.completions()).toBe(1)
  })

  test('admits one source call per attempt under its own reservation key', async () => {
    const lease = { ...rankedLease(), attemptNumber: 2 }
    const admitted: unknown[] = []

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {},
        {
          sourceAdmission: {
            admitSource: async (input) => {
              admitted.push(input)

              return { outcome: 'admitted' }
            },
          },
        },
      ),
    )

    await runJobOnce(createQueueSpy(lease).queue as never, job)

    expect(admitted).toEqual([
      {
        domain: 'brawlhalla-v1',
        reservationKey: `${lease.operationId}:2:statistics-ranked-collection`,
        units: 1,
        caller: 'background',
      },
    ])
  })

  test('stops before doing anything when the first renewal is lost', async () => {
    const spy = createQueueSpy(rankedLease(), { renewals: ['lease-lost'] })

    const job = createStatisticsRankedCollectionJob(
      dependencies({
        preflightCollection: shouldNotRun('the preflight'),
      }),
    )

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
    expect(spy.completions()).toBe(0)
  })

  test('a renewal lost after admission does not record or commit anything', async () => {
    const spy = createQueueSpy(rankedLease(), { renewals: ['renewed', 'lease-lost'] })

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {
          recordCollectionAttempt: shouldNotRun('recording the attempt'),
          commitObservation: shouldNotRun('the commit'),
        },
        { collectEvidence: shouldNotRun('the source call') },
      ),
    )

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
    expect(spy.completions()).toBe(0)
    expect(spy.failures).toEqual([])
  })

  test('an already applied collection completes without another source call', async () => {
    const spy = createQueueSpy(rankedLease())

    const job = createStatisticsRankedCollectionJob(
      dependencies(
        {
          preflightCollection: async () => 'already-applied',
          preflightCollectionAttempt: shouldNotRun('the attempt preflight'),
        },
        { collectEvidence: shouldNotRun('the source call') },
      ),
    )

    expect(await runJobOnce(spy.queue as never, job)).toBe('succeeded')
    expect(spy.completions()).toBe(1)
  })

  const conflict = { code: 'statistics_effect_conflict', retryable: false }
  const attemptConflict = { ...conflict, message: 'Statistics attempt identity conflicts' }

  const capacity = {
    code: 'statistics_capacity_exceeded',
    message: 'Statistics source attempt capacity is exhausted',
    retryable: false,
  }

  const terminalCases: [string, StatisticsStub, OperationFailure][] = [
    [
      'an effect conflict in the preflight',
      { preflightCollection: async () => 'effect-conflict' },
      { ...conflict, message: 'Statistics effect identity conflicts' },
    ],
    [
      'a capacity limit in the attempt preflight',
      { preflightCollectionAttempt: async () => 'capacity-exceeded' },
      capacity,
    ],
    [
      'an identity conflict in the attempt preflight',
      { preflightCollectionAttempt: async () => 'effect-conflict' },
      attemptConflict,
    ],
    ['a capacity limit when recording', { recordCollectionAttempt: async () => 'capacity-exceeded' }, capacity],
    [
      'an identity conflict when recording',
      { recordCollectionAttempt: async () => 'effect-conflict' },
      attemptConflict,
    ],
    [
      'an effect conflict when committing',
      { commitObservation: async () => 'effect-conflict' },
      { ...conflict, message: 'Statistics effect identity conflicts' },
    ],
  ]

  test.each(terminalCases)('%s dead-letters at once', async (_name, statistics, failure) => {
    const spy = createQueueSpy(rankedLease())
    const job = createStatisticsRankedCollectionJob(dependencies(statistics))

    expect(await runJobOnce(spy.queue as never, job)).toBe('dead_letter')
    expect(spy.failures).toEqual([{ failure, retryDelayMs: 0 }])
    expect(spy.completions()).toBe(0)
  })

  const lostCases: [string, StatisticsStub][] = [
    ['the attempt preflight', { preflightCollectionAttempt: async () => 'lease-lost' }],
    ['recording', { recordCollectionAttempt: async () => 'lease-lost' }],
    ['the commit', { commitObservation: async () => 'lease-lost' }],
  ]

  test.each(lostCases)('a lost lease in %s ends the attempt', async (_name, statistics) => {
    const spy = createQueueSpy(rankedLease())
    const job = createStatisticsRankedCollectionJob(dependencies(statistics))

    expect(await runJobOnce(spy.queue as never, job)).toBe('lease_lost')
    expect(spy.completions()).toBe(0)
    expect(spy.failures).toEqual([])
  })

  test('a thrown execution error fails with the collection code', async () => {
    const lifetimeSpy = createQueueSpy(statisticsLease('statistics-lifetime-collection', rankedPayload))
    const rankedSpy = createQueueSpy(rankedLease())

    await runJobOnce(
      rankedSpy.queue as never,
      createStatisticsRankedCollectionJob(dependencies({ preflightCollection: explode })),
      { retryDelayMs: 10 },
    )

    await runJobOnce(
      lifetimeSpy.queue as never,
      createStatisticsLifetimeCollectionJob(dependencies({ preflightCollection: explode })),
      { retryDelayMs: 10 },
    )

    for (const spy of [rankedSpy, lifetimeSpy]) {
      expect(spy.failures).toEqual([
        {
          failure: { code: 'statistics_collection_failed', message: 'execution failed', retryable: true },
          retryDelayMs: 10,
        },
      ])
    }
  })
})
