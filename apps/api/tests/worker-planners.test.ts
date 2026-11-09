import { describe, expect, test } from 'bun:test'
import type { AcceptOperationResult } from '@brawltome/queue'
import { createPlanners, type PlannerDependencies, runPlanners } from '../src/worker/planners'

type Call = [string, ...unknown[]]

type FakeOptions = {
  awaitingRefreshes?: string[]
  reservedRefreshes?: string[]
  playerLag?: number
  clanLag?: number
  reconciliationDue?: boolean
  backoffAllows?: boolean
  monitoring?: { created: number; retired: number }
  failMonitoring?: boolean
  failFirstSchedule?: boolean
  retentionEnabled?: boolean
  deepCrawlEnabled?: boolean
  scheduleOutcome?: string
}

function createFakes(options: FakeOptions = {}) {
  const calls: Call[] = []
  const logs: Array<{ event: string; fields: unknown }> = []
  let operationNumber = 0
  let scheduleFailures = options.failFirstSchedule ? 1 : 0

  const scheduleStore = (name: string) => async (argument: unknown) => {
    calls.push([name, argument])

    if (scheduleFailures > 0) {
      scheduleFailures--
      throw new Error('schedule store unavailable')
    }

    return { outcome: options.scheduleOutcome ?? 'created' }
  }

  const dependencies: PlannerDependencies = {
    operations: {
      listAwaitingInteractiveRefreshes: async () => options.awaitingRefreshes ?? [],
      activateAdmittedInteractiveRefresh: async (operationId) => {
        calls.push(['activate', operationId])

        return 'transitioned'
      },
      accept: async (input): Promise<AcceptOperationResult> => {
        calls.push(['accept', input.job.kind, input.dedupeKey, input.payload, input.provenance])
        operationNumber++

        return { outcome: 'accepted', operationId: `operation-${operationNumber}` }
      },
    },
    actorAdmission: {
      hasActorReservation: async (operationId) => (options.reservedRefreshes ?? []).includes(operationId),
    },
    primaryMonitoring: {
      readSnapshot: async () => ({ observedAt: new Date(0), targets: [] }),
      reconcile: async () => {
        calls.push(['reconcile-primary-monitoring'])

        if (options.failMonitoring) throw new Error('monitoring unavailable')

        return options.monitoring ?? { created: 0, retired: 0 }
      },
    },
    discovery: {
      sources: {
        player: { lag: async () => options.playerLag ?? 0 },
        clan: { lag: async () => options.clanLag ?? 0 },
      },
      checks: {
        reconciliationDue: async (owner) => {
          calls.push(['reconciliation-due', owner])

          return options.reconciliationDue ?? false
        },
      },
      reconciliationBackoff: {
        shouldEnqueue: async () => options.backoffAllows ?? true,
        recordEnqueued: (owner, operationId) => calls.push(['record-enqueued', owner, operationId]),
      },
      config: { projectionBatchSize: 25, reconciliationIntervalMs: 60_000 },
    },
    statisticsCohort: {
      reconcile: async () => {
        calls.push(['statistics-cohort'])

        return 5
      },
    },
    nameVerification: {
      tick: async () => {
        calls.push(['name-verification'])

        return 7
      },
    },
    freshness: {
      tick: async () => {
        calls.push(['freshness'])

        return 11
      },
    },
    schedules: {
      store: {
        leaderboard: scheduleStore('leaderboard-schedule'),
        retention: scheduleStore('retention-schedule'),
        disableRetention: scheduleStore('disable-retention'),
        deepCrawl: scheduleStore('deep-crawl-schedule'),
        disableDeepCrawl: scheduleStore('disable-deep-crawl'),
        clanWeeklySnapshot: scheduleStore('clan-weekly-snapshot-schedule'),
      },
      leaderboard: [{ scheduleKey: 'rankings:1v1:v1' }, { scheduleKey: 'rankings:2v2:v1' }] as never,
      rankingRetention: {
        config: { enabled: options.retentionEnabled ?? true, retentionHours: 48, maxGenerations: 6 },
        definition: { scheduleKey: 'rankings:retention:v1' } as never,
      },
      deepCrawl: {
        config: { enabled: options.deepCrawlEnabled ?? true, intervalMs: 3_600_000 },
        definitions: [{ scheduleKey: 'rankings:1v1:deep:EU' }] as never,
      },
      clanWeeklySnapshot: {
        scheduleKey: 'clans:weekly-snapshot:v1',
        firstDueAt: '2026-11-19T10:30:00.000Z',
      } as never,
    },
    telemetry: { logger: { info: (event, fields) => logs.push({ event, fields }) } },
  }

  return { dependencies, calls, logs }
}

function callNames(calls: Call[]): string[] {
  return calls.map(([name]) => name)
}

describe('worker planners', () => {
  test('runs every planner on each tick', async () => {
    const { dependencies } = createFakes({
      awaitingRefreshes: ['refresh-1', 'refresh-2'],
      reservedRefreshes: ['refresh-1', 'refresh-2'],
      monitoring: { created: 3, retired: 4 },
    })

    const planners = createPlanners(dependencies)

    expect(planners.map(({ name }) => name)).toEqual([
      'interactive-admissions',
      'primary-monitoring',
      'discovery',
      'statistics-cohort',
      'player-name-verification',
      'freshness',
      'leaderboard-schedules',
    ])

    // 2 activated + 7 monitoring + 5 cohort + 7 name verification + 11 freshness + 5 schedules
    expect(await runPlanners(planners)).toBe(2 + 7 + 5 + 7 + 11 + 5)
    // the schedules are already in place on the second tick
    expect(await runPlanners(planners)).toBe(2 + 7 + 5 + 7 + 11)
  })

  test('runs the planners in a fixed order', async () => {
    const { dependencies, calls } = createFakes({ awaitingRefreshes: ['refresh-1'], reservedRefreshes: ['refresh-1'] })

    await runPlanners(createPlanners(dependencies))

    expect(callNames(calls)).toEqual([
      'activate',
      'reconcile-primary-monitoring',
      'reconciliation-due',
      'reconciliation-due',
      'statistics-cohort',
      'name-verification',
      'freshness',
      'leaderboard-schedule',
      'leaderboard-schedule',
      'retention-schedule',
      'deep-crawl-schedule',
      'clan-weekly-snapshot-schedule',
    ])
  })

  test('skips interactive refreshes whose actor reservation has not come through', async () => {
    const { dependencies, calls } = createFakes({
      awaitingRefreshes: ['refresh-1', 'refresh-2'],
      reservedRefreshes: ['refresh-2'],
    })

    const [interactiveAdmissions] = createPlanners(dependencies)

    expect(await interactiveAdmissions.tick()).toBe(1)
    expect(calls).toEqual([['activate', 'refresh-2']])
  })

  test('stops the tick when a planner throws', async () => {
    const { dependencies, calls } = createFakes({ failMonitoring: true })

    await expect(runPlanners(createPlanners(dependencies))).rejects.toThrow('monitoring unavailable')
    expect(callNames(calls)).toEqual(['reconcile-primary-monitoring'])
  })

  describe('schedules', () => {
    function schedulesPlanner(fakes: ReturnType<typeof createFakes>) {
      const planner = createPlanners(fakes.dependencies).find(({ name }) => name === 'leaderboard-schedules')

      if (!planner) throw new Error('leaderboard-schedules planner is missing')

      return planner
    }

    test('reconcile once per process', async () => {
      const fakes = createFakes()
      const planner = schedulesPlanner(fakes)

      expect(await planner.tick()).toBe(5)

      const callsAfterFirstTick = fakes.calls.length

      expect(await planner.tick()).toBe(0)
      expect(fakes.calls).toHaveLength(callsAfterFirstTick)

      expect(fakes.logs.map(({ event }) => event)).toEqual([
        'ranking.retention.scheduled',
        'leaderboard.deep_crawl.scheduled',
        'clan.weekly_snapshot.scheduled',
      ])
    })

    test('a new set of planners reconciles again', async () => {
      const fakes = createFakes()

      await schedulesPlanner(fakes).tick()

      expect(await schedulesPlanner(fakes).tick()).toBe(5)
    })

    test('try again on the next tick when reconciling failed part way', async () => {
      const fakes = createFakes({ failFirstSchedule: true })
      const planner = schedulesPlanner(fakes)

      await expect(planner.tick()).rejects.toThrow('schedule store unavailable')
      expect(await planner.tick()).toBe(5)
      expect(fakes.logs).toHaveLength(3)
    })

    test('count only schedules that changed', async () => {
      const fakes = createFakes({ scheduleOutcome: 'already-exists' })

      expect(await schedulesPlanner(fakes).tick()).toBe(0)
    })

    test('disable retention and deep crawl when switched off, and log how they were left', async () => {
      const fakes = createFakes({
        retentionEnabled: false,
        deepCrawlEnabled: false,
        scheduleOutcome: 'already-disabled',
      })

      // leaderboard schedules count anything but 'already-exists', retention and deep crawl also skip 'already-disabled'
      expect(await schedulesPlanner(fakes).tick()).toBe(2)

      expect(callNames(fakes.calls)).toEqual([
        'leaderboard-schedule',
        'leaderboard-schedule',
        'disable-retention',
        'disable-deep-crawl',
        'clan-weekly-snapshot-schedule',
      ])

      expect(fakes.calls.slice(2, 4)).toEqual([
        ['disable-retention', 'rankings:retention:v1'],
        ['disable-deep-crawl', 'rankings:1v1:deep:EU'],
      ])

      expect(fakes.logs).toEqual([
        {
          event: 'ranking.retention.scheduled',
          fields: { enabled: false, outcome: 'already-disabled', retentionHours: 48, maxGenerations: 6 },
        },
        { event: 'leaderboard.deep_crawl.scheduled', fields: { enabled: false, intervalMs: 3_600_000 } },
        {
          event: 'clan.weekly_snapshot.scheduled',
          fields: { outcome: 'already-disabled', firstDueAt: '2026-11-19T10:30:00.000Z' },
        },
      ])
    })
  })

  describe('discovery', () => {
    function discoveryPlanner(fakes: ReturnType<typeof createFakes>) {
      const planner = createPlanners(fakes.dependencies).find(({ name }) => name === 'discovery')

      if (!planner) throw new Error('discovery planner is missing')

      return planner
    }

    test('enqueues a projection only when lag is above zero', async () => {
      const idle = createFakes({ playerLag: 0, clanLag: 0 })

      expect(await discoveryPlanner(idle).tick()).toBe(0)
      expect(callNames(idle.calls)).not.toContain('accept')

      const lagging = createFakes({ playerLag: 3, clanLag: 0 })

      expect(await discoveryPlanner(lagging).tick()).toBe(1)

      expect(lagging.calls.filter(([name]) => name === 'accept')).toEqual([
        [
          'accept',
          'player-discovery-projection',
          'discovery:player:pending',
          { batchSize: 25 },
          { source: 'projection-delivery', requestedBy: 'issue-200' },
        ],
      ])
    })

    test('enqueues a projection for each owner that lags, player first', async () => {
      const fakes = createFakes({ playerLag: 1, clanLag: 2 })

      expect(await discoveryPlanner(fakes).tick()).toBe(2)

      expect(fakes.calls.filter(([name]) => name === 'accept').map(([, kind]) => kind)).toEqual([
        'player-discovery-projection',
        'clan-discovery-projection',
      ])
    })

    test('enqueues a reconciliation when due and the backoff allows it', async () => {
      const fakes = createFakes({ reconciliationDue: true })

      expect(await discoveryPlanner(fakes).tick()).toBe(2)

      expect(fakes.calls).toEqual([
        ['reconciliation-due', 'player'],
        [
          'accept',
          'discovery-reconciliation',
          'discovery:player:reconciliation',
          { owner: 'player' },
          expect.anything(),
        ],
        ['record-enqueued', 'player', 'operation-1'],
        ['reconciliation-due', 'clan'],
        ['accept', 'discovery-reconciliation', 'discovery:clan:reconciliation', { owner: 'clan' }, expect.anything()],
        ['record-enqueued', 'clan', 'operation-2'],
      ])
    })

    test('holds off the reconciliation while the backoff says to wait', async () => {
      const fakes = createFakes({ reconciliationDue: true, backoffAllows: false })

      expect(await discoveryPlanner(fakes).tick()).toBe(0)
      expect(callNames(fakes.calls)).not.toContain('accept')
    })
  })
})
