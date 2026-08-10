import {
  type AdmissionConfig,
  type BackgroundWorkClass,
  type WorkClass,
  maxLeaderboardIntervalMs,
  minLeaderboardIntervalMs,
  validateAdmissionConfig,
} from '@brawltome/refresh-operations'

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`)
  }
  return parsed
}

function boundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

const classEnvironment: Record<WorkClass, string> = {
  interactive: 'OPERATIONS_INTERACTIVE_CONCURRENCY',
  'primary-monitoring': 'OPERATIONS_PRIMARY_MONITORING_CONCURRENCY',
  leaderboard: 'OPERATIONS_LEADERBOARD_CONCURRENCY',
  'global-statistics': 'OPERATIONS_GLOBAL_STATISTICS_CONCURRENCY',
  projection: 'OPERATIONS_PROJECTION_CONCURRENCY',
  maintenance: 'OPERATIONS_MAINTENANCE_CONCURRENCY',
}

const weightEnvironment: Record<BackgroundWorkClass, string> = {
  'primary-monitoring': 'OPERATIONS_PRIMARY_MONITORING_WEIGHT',
  leaderboard: 'OPERATIONS_LEADERBOARD_WEIGHT',
  'global-statistics': 'OPERATIONS_GLOBAL_STATISTICS_WEIGHT',
  projection: 'OPERATIONS_PROJECTION_WEIGHT',
  maintenance: 'OPERATIONS_MAINTENANCE_WEIGHT',
}

const leaderboardModes = [
  { mode: '1v1', kind: 'leaderboard-1v1' },
  { mode: '2v2', kind: 'leaderboard-2v2' },
  { mode: 'solo2v2', kind: 'leaderboard-solo-2v2' },
  { mode: '3v3', kind: 'leaderboard-3v3' },
] as const

export function leaderboardScheduleDefinitions(config: {
  pageDepth: number
  intervalMs: number
  firstDueAt: string
}) {
  const baseDueAt = new Date(config.firstDueAt).getTime()
  if (!Number.isFinite(baseDueAt)) throw new Error('leaderboard firstDueAt must be a valid timestamp')
  const staggerMs = Math.floor(config.intervalMs / leaderboardModes.length)
  return leaderboardModes.map((definition, index) => ({
    ...definition,
    scheduleKey: `rankings:${definition.mode}:v1`,
    operationKeyPrefix: `rankings:${definition.mode}`,
    workClass: 'leaderboard' as const,
    intervalMs: config.intervalMs,
    firstDueAt: new Date(baseDueAt + index * staggerMs).toISOString(),
    payload: { pageDepth: config.pageDepth, intervalMs: config.intervalMs },
    provenance: { source: 'rankings-schedule', requestedBy: 'issue-202' },
  }))
}

export function readOperationsWorkerConfig(env: NodeJS.ProcessEnv) {
  const classDefaults: Record<WorkClass, number> = {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  }
  const weightDefaults: Record<BackgroundWorkClass, number> = {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  }
  const admission: AdmissionConfig = {
    totalConcurrency: positiveInteger(env.OPERATIONS_TOTAL_CONCURRENCY, 8, 'OPERATIONS_TOTAL_CONCURRENCY', 32),
    interactiveReservation: positiveInteger(
      env.OPERATIONS_INTERACTIVE_RESERVATION,
      2,
      'OPERATIONS_INTERACTIVE_RESERVATION',
      10_000,
    ),
    classConcurrency: Object.fromEntries(
      Object.entries(classEnvironment).map(([workClass, name]) => [
        workClass,
        positiveInteger(env[name], classDefaults[workClass as WorkClass], name, 10_000),
      ]),
    ) as Record<WorkClass, number>,
    backgroundWeights: Object.fromEntries(
      Object.entries(weightEnvironment).map(([workClass, name]) => [
        workClass,
        positiveInteger(env[name], weightDefaults[workClass as BackgroundWorkClass], name, 10_000),
      ]),
    ) as Record<BackgroundWorkClass, number>,
  }

  return {
    leaseMs: positiveInteger(env.OPERATIONS_LEASE_MS, 30_000, 'OPERATIONS_LEASE_MS', 300_000),
    pollMs: positiveInteger(env.OPERATIONS_POLL_MS, 1_000, 'OPERATIONS_POLL_MS', 60_000),
    retryDelayMs: positiveInteger(env.OPERATIONS_RETRY_DELAY_MS, 1_000, 'OPERATIONS_RETRY_DELAY_MS', 300_000),
    scheduleBatchSize: positiveInteger(
      env.OPERATIONS_SCHEDULE_BATCH_SIZE,
      100,
      'OPERATIONS_SCHEDULE_BATCH_SIZE',
      1_000,
    ),
    leaderboard: {
      pageDepth: positiveInteger(env.LEADERBOARD_PAGE_DEPTH, 1, 'LEADERBOARD_PAGE_DEPTH', 20),
      intervalMs: boundedInteger(
        env.LEADERBOARD_INTERVAL_MS,
        15 * 60 * 1000,
        'LEADERBOARD_INTERVAL_MS',
        minLeaderboardIntervalMs,
        maxLeaderboardIntervalMs,
      ),
      firstDueAt: '2020-01-01T00:00:00.000Z',
    },
    admission: validateAdmissionConfig(admission),
  }
}
