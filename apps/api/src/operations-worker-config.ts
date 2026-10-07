import { defaultLeaderboardIntervalMs, defaultLeaderboardPageDepth } from '@brawltome/ranking'
import {
  type AdmissionConfig,
  type BackgroundWorkClass,
  type CreateLeaderboardDeepCrawlSchedule,
  type CreateRankingRetentionSchedule,
  type WorkClass,
  leaderboardDeepCrawlRegions,
  maxLeaderboardDeepCrawlIntervalMs,
  maxLeaderboardIntervalMs,
  maxRankingRetentionBatch,
  maxRankingRetentionHours,
  minLeaderboardDeepCrawlIntervalMs,
  minLeaderboardIntervalMs,
  minRankingRetentionHours,
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

function strictBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function readBrawlhallaV1RequestLimit(value: string | undefined): number {
  return boundedInteger(value, 1_800, 'BRAWLHALLA_V1_REQUEST_LIMIT', 1, 1_800)
}

export function readSourceBackgroundHeadroom(value: string | undefined, minimumSourceLimit: number): number {
  return boundedInteger(value, 30, 'SOURCE_BACKGROUND_HEADROOM', 0, minimumSourceLimit - 1)
}

export type WorkerDatabaseSessionConfig = {
  connectTimeoutSeconds: number
  statementTimeoutMs: number
  idleInTransactionSessionTimeoutMs: number
}

/**
 * Adds connection and server-side session timeouts to the worker's connection string so every postgres.js client
 * the worker creates inherits them. Parameters already present in the URL win, so operators can still override.
 */
export function workerDatabaseUrl(connectionString: string, config: WorkerDatabaseSessionConfig): string {
  const url = new URL(connectionString)
  const defaults: Record<string, number> = {
    connect_timeout: config.connectTimeoutSeconds,
    statement_timeout: config.statementTimeoutMs,
    idle_in_transaction_session_timeout: config.idleInTransactionSessionTimeoutMs,
  }
  for (const [name, value] of Object.entries(defaults)) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, String(value))
  }
  return url.toString()
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

export type RankingRetentionConfig = {
  // false pauses retention: the schedule is disabled and leftover runs complete without deleting anything.
  enabled: boolean
  retentionHours: number
  maxGenerations: number
  intervalMs: number
  firstDueAt: string
}

// One maintenance run every 15 minutes, offset from the leaderboard windows, expires at most one bounded batch.
export function rankingRetentionScheduleDefinition(config: RankingRetentionConfig): CreateRankingRetentionSchedule {
  return {
    kind: 'ranking-retention',
    scheduleKey: 'rankings:retention:v1',
    operationKeyPrefix: 'rankings:retention',
    workClass: 'maintenance',
    intervalMs: config.intervalMs,
    firstDueAt: config.firstDueAt,
    payload: { retentionHours: config.retentionHours, maxGenerations: config.maxGenerations },
    provenance: { source: 'ranking-retention-schedule', requestedBy: 'ranking-retention' },
  }
}

export type LeaderboardDeepCrawlConfig = {
  // false disables the region schedules; runs already materialized still complete.
  enabled: boolean
  intervalMs: number
  firstDueAt: string
}

// One crawl per region per interval, spread evenly so the regions never compete for V1 admission at once.
export function leaderboardDeepCrawlScheduleDefinitions(
  config: LeaderboardDeepCrawlConfig,
): CreateLeaderboardDeepCrawlSchedule[] {
  const baseDueAt = new Date(config.firstDueAt).getTime()
  const staggerMs = Math.floor(config.intervalMs / leaderboardDeepCrawlRegions.length)
  return leaderboardDeepCrawlRegions.map((region, index) => ({
    kind: 'leaderboard-deep-crawl' as const,
    scheduleKey: `rankings:1v1:deep:${region}`,
    operationKeyPrefix: `rankings:1v1:deep:${region}`,
    workClass: 'leaderboard' as const,
    intervalMs: config.intervalMs,
    firstDueAt: new Date(baseDueAt + index * staggerMs).toISOString(),
    payload: { region, intervalMs: config.intervalMs },
    provenance: { source: 'leaderboard-deep-crawl-schedule', requestedBy: 'proactive-freshness' },
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

  // Retryable failures back off exponentially (2s, 6s, then capped at 15s by default) with +/-20% jitter so a
  // brief upstream hiccup is ridden out across four interactive attempts while the whole retry window stays
  // inside the ~30s the profile page waits for a refresh. Rate-limited work keeps its Retry-After delay.
  const retryDelayMs = positiveInteger(env.OPERATIONS_RETRY_DELAY_MS, 2_000, 'OPERATIONS_RETRY_DELAY_MS', 300_000)
  const retryBackoff = {
    multiplier: boundedInteger(
      env.OPERATIONS_RETRY_BACKOFF_MULTIPLIER,
      3,
      'OPERATIONS_RETRY_BACKOFF_MULTIPLIER',
      1,
      10,
    ),
    maxDelayMs: boundedInteger(
      env.OPERATIONS_RETRY_MAX_DELAY_MS,
      Math.max(15_000, retryDelayMs),
      'OPERATIONS_RETRY_MAX_DELAY_MS',
      retryDelayMs,
      900_000,
    ),
    jitterRatio: 0.2,
  }

  // After a dead-lettered discovery reconciliation, wait 5 minutes (doubling per consecutive failure, capped at
  // an hour) before enqueueing another one instead of re-enqueueing on every scheduler tick.
  const reconciliationFailureBackoffMs = boundedInteger(
    env.DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS,
    5 * 60 * 1000,
    'DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS',
    60_000,
    24 * 60 * 60 * 1000,
  )

  return {
    leaseMs: positiveInteger(env.OPERATIONS_LEASE_MS, 30_000, 'OPERATIONS_LEASE_MS', 300_000),
    pollMs: positiveInteger(env.OPERATIONS_POLL_MS, 1_000, 'OPERATIONS_POLL_MS', 60_000),
    retryDelayMs,
    retryBackoff,
    sourceUnavailableRetryMs: boundedInteger(
      env.SOURCE_UNAVAILABLE_RETRY_MS,
      60_000,
      'SOURCE_UNAVAILABLE_RETRY_MS',
      1_000,
      900_000,
    ),
    scheduleBatchSize: positiveInteger(
      env.OPERATIONS_SCHEDULE_BATCH_SIZE,
      100,
      'OPERATIONS_SCHEDULE_BATCH_SIZE',
      1_000,
    ),
    // Exit (and let Docker restart the worker) when no loop has iterated for 10 minutes: every call is hung.
    stallTimeoutMs: boundedInteger(
      env.OPERATIONS_STALL_TIMEOUT_MS,
      10 * 60 * 1000,
      'OPERATIONS_STALL_TIMEOUT_MS',
      60_000,
      60 * 60 * 1000,
    ),
    // Worker statements are batched (discovery reconciliation streams ~188s as many short statements), so a
    // 5-minute per-statement and idle-in-transaction ceiling only ends sessions that are genuinely stuck.
    database: {
      connectTimeoutSeconds: boundedInteger(
        env.OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS,
        10,
        'OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS',
        1,
        120,
      ),
      statementTimeoutMs: boundedInteger(
        env.OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS,
        5 * 60 * 1000,
        'OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS',
        1_000,
        60 * 60 * 1000,
      ),
      idleInTransactionSessionTimeoutMs: boundedInteger(
        env.OPERATIONS_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
        5 * 60 * 1000,
        'OPERATIONS_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS',
        1_000,
        60 * 60 * 1000,
      ),
    } satisfies WorkerDatabaseSessionConfig,
    discovery: {
      // Full-snapshot reconciliation reads every player in long single statements; the worker-wide 5 min limit
      // cancelled it (SQLSTATE 57014) and turned it into a retry loop, so discovery sessions get their own ceiling.
      statementTimeoutMs: boundedInteger(
        env.OPERATIONS_DISCOVERY_STATEMENT_TIMEOUT_MS,
        30 * 60 * 1000,
        'OPERATIONS_DISCOVERY_STATEMENT_TIMEOUT_MS',
        60_000,
        2 * 60 * 60 * 1000,
      ),
      projectionBatchSize: boundedInteger(
        env.DISCOVERY_PROJECTION_BATCH_SIZE,
        500,
        'DISCOVERY_PROJECTION_BATCH_SIZE',
        1,
        1_000,
      ),
      reconciliationIntervalMs: boundedInteger(
        env.DISCOVERY_RECONCILIATION_INTERVAL_MS,
        60 * 60 * 1000,
        'DISCOVERY_RECONCILIATION_INTERVAL_MS',
        60_000,
        24 * 60 * 60 * 1000,
      ),
      reconciliationFailureBackoffMs,
      reconciliationMaxFailureBackoffMs: boundedInteger(
        env.DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS,
        Math.max(60 * 60 * 1000, reconciliationFailureBackoffMs),
        'DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS',
        reconciliationFailureBackoffMs,
        24 * 60 * 60 * 1000,
      ),
    },
    leaderboard: {
      pageDepth: positiveInteger(env.LEADERBOARD_PAGE_DEPTH, defaultLeaderboardPageDepth, 'LEADERBOARD_PAGE_DEPTH', 20),
      intervalMs: boundedInteger(
        env.LEADERBOARD_INTERVAL_MS,
        defaultLeaderboardIntervalMs,
        'LEADERBOARD_INTERVAL_MS',
        minLeaderboardIntervalMs,
        maxLeaderboardIntervalMs,
      ),
      firstDueAt: '2020-01-01T00:00:00.000Z',
    },
    rankingRetention: {
      enabled: strictBoolean(env.RANKING_RETENTION_ENABLED, true, 'RANKING_RETENTION_ENABLED'),
      retentionHours: boundedInteger(
        env.RANKING_RETENTION_HOURS,
        24,
        'RANKING_RETENTION_HOURS',
        minRankingRetentionHours,
        maxRankingRetentionHours,
      ),
      maxGenerations: boundedInteger(
        env.RANKING_RETENTION_BATCH,
        20,
        'RANKING_RETENTION_BATCH',
        1,
        maxRankingRetentionBatch,
      ),
      intervalMs: 15 * 60 * 1000,
      firstDueAt: '2020-01-01T00:05:00.000Z',
    } satisfies RankingRetentionConfig,
    deepCrawl: {
      enabled: strictBoolean(env.DEEP_CRAWL_ENABLED, true, 'DEEP_CRAWL_ENABLED'),
      intervalMs: boundedInteger(
        env.DEEP_CRAWL_INTERVAL_MS,
        3 * 60 * 60 * 1000,
        'DEEP_CRAWL_INTERVAL_MS',
        minLeaderboardDeepCrawlIntervalMs,
        maxLeaderboardDeepCrawlIntervalMs,
      ),
      // The first windows land after the rollout instead of all being overdue at once; regions then stay staggered.
      firstDueAt: '2026-10-07T16:00:00.000Z',
    } satisfies LeaderboardDeepCrawlConfig,
    admission: validateAdmissionConfig(admission),
  }
}
