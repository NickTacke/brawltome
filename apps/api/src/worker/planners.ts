import { randomUUID } from 'node:crypto'
import {
  clanDiscoveryProjectionContract,
  discoveryReconciliationContract,
  type PostgresDiscovery,
  playerDiscoveryProjectionContract,
} from '@brawltome/discovery'
import type { PrimaryMonitoringSnapshot } from '@brawltome/player'
import type {
  AcceptOperationInput,
  AcceptOperationResult,
  CreateLeaderboardDeepCrawlSchedule,
  CreateLeaderboardSchedule,
  CreateRankingRetentionSchedule,
  ReconcileResourceSchedulesResult,
  RefreshOperationWorker,
} from '@brawltome/queue'
import type { ActorAdmission } from '@brawltome/request-admission'
import type { createDiscoveryReconciliationBackoff } from '../discovery-reconciliation-backoff'
import { reconcileInteractiveAdmissions } from './interactive-admissions'

// one concern of the reconcile step: tick() does its planning and returns how many things it changed
export type Planner = { name: string; tick(): Promise<number> }

type DiscoveryOwner = 'player' | 'clan'

type ScheduleResult = { outcome: string }

export type ScheduleStore = {
  leaderboard(schedule: CreateLeaderboardSchedule): Promise<ScheduleResult>
  retention(schedule: CreateRankingRetentionSchedule): Promise<ScheduleResult>
  disableRetention(scheduleKey: string): Promise<ScheduleResult>
  deepCrawl(schedule: CreateLeaderboardDeepCrawlSchedule): Promise<ScheduleResult>
  disableDeepCrawl(scheduleKey: string): Promise<ScheduleResult>
}

export type PlannerDependencies = {
  operations: Pick<
    RefreshOperationWorker,
    'listAwaitingInteractiveRefreshes' | 'activateAdmittedInteractiveRefresh'
  > & {
    accept(input: AcceptOperationInput<unknown>): Promise<AcceptOperationResult>
  }
  actorAdmission: Pick<ActorAdmission, 'hasActorReservation'>
  primaryMonitoring: {
    readSnapshot(): Promise<PrimaryMonitoringSnapshot>
    reconcile(
      snapshot: PrimaryMonitoringSnapshot,
    ): Promise<Pick<ReconcileResourceSchedulesResult, 'created' | 'retired'>>
  }
  discovery: {
    sources: Record<DiscoveryOwner, { lag(): Promise<number> }>
    checks: Pick<PostgresDiscovery, 'reconciliationDue'>
    reconciliationBackoff: Pick<
      ReturnType<typeof createDiscoveryReconciliationBackoff>,
      'shouldEnqueue' | 'recordEnqueued'
    >
    config: { projectionBatchSize: number; reconciliationIntervalMs: number }
  }
  statisticsCohort: { reconcile(): Promise<number> }
  nameVerification: Pick<Planner, 'tick'>
  freshness: Pick<Planner, 'tick'>
  schedules: {
    store: ScheduleStore
    leaderboard: readonly CreateLeaderboardSchedule[]
    rankingRetention: {
      config: { enabled: boolean; retentionHours: number; maxGenerations: number }
      definition: CreateRankingRetentionSchedule
    }
    deepCrawl: {
      config: { enabled: boolean; intervalMs: number }
      definitions: readonly CreateLeaderboardDeepCrawlSchedule[]
    }
  }
  telemetry: { logger: { info(event: string, fields: Record<string, unknown>): void } }
}

const discoveryDefinitions = [
  { owner: 'player', projection: playerDiscoveryProjectionContract },
  { owner: 'clan', projection: clanDiscoveryProjectionContract },
] as const

function createInteractiveAdmissionsPlanner({ operations, actorAdmission }: PlannerDependencies): Planner {
  return {
    name: 'interactive-admissions',
    tick: () => reconcileInteractiveAdmissions(operations, actorAdmission),
  }
}

function createPrimaryMonitoringPlanner({ primaryMonitoring }: PlannerDependencies): Planner {
  return {
    name: 'primary-monitoring',
    async tick() {
      const snapshot = await primaryMonitoring.readSnapshot()
      const { created, retired } = await primaryMonitoring.reconcile(snapshot)

      return created + retired
    },
  }
}

async function enqueueDiscoveryProjection(
  { operations, discovery }: PlannerDependencies,
  owner: DiscoveryOwner,
  job: typeof playerDiscoveryProjectionContract,
): Promise<number> {
  if ((await discovery.sources[owner].lag()) <= 0) return 0

  const projection = await operations.accept({
    job,
    dedupeKey: `discovery:${owner}:pending`,
    operationKey: `discovery:${owner}:${randomUUID()}`,
    workClass: 'projection',
    payload: { batchSize: discovery.config.projectionBatchSize },
    provenance: { source: 'projection-delivery', requestedBy: 'issue-200' },
  })

  return projection.outcome === 'accepted' ? 1 : 0
}

async function enqueueDiscoveryReconciliation(
  { operations, discovery }: PlannerDependencies,
  owner: DiscoveryOwner,
): Promise<number> {
  const isDue = await discovery.checks.reconciliationDue(owner, discovery.config.reconciliationIntervalMs)

  if (!isDue || !(await discovery.reconciliationBackoff.shouldEnqueue(owner))) return 0

  const reconciliation = await operations.accept({
    job: discoveryReconciliationContract,
    dedupeKey: `discovery:${owner}:reconciliation`,
    operationKey: `discovery:${owner}:reconciliation:${randomUUID()}`,
    workClass: 'projection',
    payload: { owner },
    provenance: { source: 'owner-fact-reconciliation', requestedBy: 'issue-200' },
  })

  discovery.reconciliationBackoff.recordEnqueued(owner, reconciliation.operationId)

  return reconciliation.outcome === 'accepted' ? 1 : 0
}

function createDiscoveryPlanner(dependencies: PlannerDependencies): Planner {
  return {
    name: 'discovery',
    async tick() {
      let enqueued = 0

      for (const { owner, projection } of discoveryDefinitions) {
        enqueued += await enqueueDiscoveryProjection(dependencies, owner, projection)
        enqueued += await enqueueDiscoveryReconciliation(dependencies, owner)
      }

      return enqueued
    },
  }
}

function isScheduleChanged(result: ScheduleResult): boolean {
  return result.outcome !== 'already-exists' && result.outcome !== 'already-disabled'
}

async function reconcileLeaderboardSchedules({ schedules }: PlannerDependencies): Promise<number> {
  let changed = 0

  for (const definition of schedules.leaderboard) {
    const schedule = await schedules.store.leaderboard(definition)

    if (schedule.outcome !== 'already-exists') changed++
  }

  return changed
}

async function reconcileRetentionSchedule({ schedules, telemetry }: PlannerDependencies): Promise<number> {
  const { config, definition } = schedules.rankingRetention

  const retention = config.enabled
    ? await schedules.store.retention(definition)
    : await schedules.store.disableRetention(definition.scheduleKey)

  telemetry.logger.info('ranking.retention.scheduled', {
    enabled: config.enabled,
    outcome: retention.outcome,
    retentionHours: config.retentionHours,
    maxGenerations: config.maxGenerations,
  })

  return isScheduleChanged(retention) ? 1 : 0
}

async function reconcileDeepCrawlSchedules({ schedules, telemetry }: PlannerDependencies): Promise<number> {
  const { config, definitions } = schedules.deepCrawl
  let changed = 0

  for (const definition of definitions) {
    const crawl = config.enabled
      ? await schedules.store.deepCrawl(definition)
      : await schedules.store.disableDeepCrawl(definition.scheduleKey)

    if (isScheduleChanged(crawl)) changed++
  }

  telemetry.logger.info('leaderboard.deep_crawl.scheduled', { enabled: config.enabled, intervalMs: config.intervalMs })

  return changed
}

// schedules only change with configuration, so once per process is enough; a failed pass is retried on the next tick
function createScheduleReconciliationPlanner(dependencies: PlannerDependencies): Planner {
  let isReconciled = false

  return {
    name: 'leaderboard-schedules',
    async tick() {
      if (isReconciled) return 0

      const leaderboard = await reconcileLeaderboardSchedules(dependencies)
      const retention = await reconcileRetentionSchedule(dependencies)
      const deepCrawl = await reconcileDeepCrawlSchedules(dependencies)

      isReconciled = true

      return leaderboard + retention + deepCrawl
    },
  }
}

export function createPlanners(dependencies: PlannerDependencies): readonly Planner[] {
  return [
    createInteractiveAdmissionsPlanner(dependencies),
    createPrimaryMonitoringPlanner(dependencies),
    createDiscoveryPlanner(dependencies),
    { name: 'statistics-cohort', tick: () => dependencies.statisticsCohort.reconcile() },
    { name: 'player-name-verification', tick: () => dependencies.nameVerification.tick() },
    { name: 'freshness', tick: () => dependencies.freshness.tick() },
    createScheduleReconciliationPlanner(dependencies),
  ]
}

// one after another, in list order: a planner that throws ends the tick before the later ones run
export async function runPlanners(planners: readonly Planner[]): Promise<number> {
  let changed = 0

  for (const planner of planners) changed += await planner.tick()

  return changed
}
