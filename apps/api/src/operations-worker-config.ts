import { parseBoundedInteger, parsePositiveInteger } from '@brawltome/foundation'
import { defaultLeaderboardIntervalMs, defaultLeaderboardPageDepth } from '@brawltome/ranking'
import {
  type AdmissionConfig,
  type BackgroundWorkClass,
  type CreateLeaderboardDeepCrawlSchedule,
  type CreateRankingRetentionSchedule,
  type LeaderboardDeepCrawlMode,
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

function strictBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback

  if (value === 'true') return true

  if (value === 'false') return false

  throw new Error(`${name} must be true or false`)
}

export function readBrawlhallaV1RequestLimit(value: string | undefined): number {
  return parseBoundedInteger(value, {
    name: 'BRAWLHALLA_V1_REQUEST_LIMIT',
    fallback: 1_800,
    minimum: 1,
    maximum: 1_800,
  })
}

export function readSourceBackgroundHeadroom(value: string | undefined, minimumSourceLimit: number): number {
  return parseBoundedInteger(value, {
    name: 'SOURCE_BACKGROUND_HEADROOM',
    fallback: 30,
    minimum: 0,
    maximum: minimumSourceLimit - 1,
  })
}

// the deploy connection budget (database-pools.ts, CONTRIBUTING.md) is computed for this many job slots
export const maxOperationsTotalConcurrency = 23

// the worker's discovery pool is sized for this many projection operations at once (see database-pools.ts)
export const maxProjectionConcurrency = 2

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
  // Pause after each page. Pages took ~0.33 s unpaced in production, so 150 ms gives ~2 pages/s: a full 1v1 pass
  // (~5,600 pages) in ~45 minutes at roughly 600 V1 calls per 5 minutes, well under the 1800 limit.
  pageDelayMs: number
  // Solo 2v2 (~800 pages) and fixed 2v2 teams (~2,600 pages) run less often so an hourly 1v1 pass still fits the hour
  // on the single leaderboard slot.
  soloIntervalMs: number
  teamsIntervalMs: number
}

// One crawl per region per interval, spread evenly so the regions never compete for V1 admission at once.
export function leaderboardDeepCrawlScheduleDefinitions(
  config: LeaderboardDeepCrawlConfig,
): CreateLeaderboardDeepCrawlSchedule[] {
  const baseDueAt = new Date(config.firstDueAt).getTime()

  const definitions = (
    mode: LeaderboardDeepCrawlMode,
    intervalMs: number,
    offsetMs: number,
  ): CreateLeaderboardDeepCrawlSchedule[] => {
    const staggerMs = Math.floor(intervalMs / leaderboardDeepCrawlRegions.length)

    return leaderboardDeepCrawlRegions.map((region, index) => ({
      kind: 'leaderboard-deep-crawl' as const,
      scheduleKey: `rankings:${mode}:deep:${region}`,
      operationKeyPrefix: `rankings:${mode}:deep:${region}`,
      workClass: 'leaderboard' as const,
      intervalMs,
      firstDueAt: new Date(baseDueAt + offsetMs + index * staggerMs).toISOString(),
      // The original 1v1 schedules carry no mode; keeping their payload keeps their definition unchanged.
      payload: mode === '1v1' ? { region, intervalMs } : { mode, region, intervalMs },
      provenance: { source: 'leaderboard-deep-crawl-schedule', requestedBy: 'proactive-freshness' },
    }))
  }

  // Solo 2v2 regions start halfway between the 1v1 ones; each mode then keeps its own cadence.
  return [
    ...definitions('1v1', config.intervalMs, 0),
    ...definitions(
      'solo2v2',
      config.soloIntervalMs,
      Math.floor(config.intervalMs / leaderboardDeepCrawlRegions.length / 2),
    ),
    ...definitions('2v2', config.teamsIntervalMs, 15 * 60 * 1000),
  ]
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

  const classMaximums: Partial<Record<WorkClass, number>> = { projection: maxProjectionConcurrency }

  const weightDefaults: Record<BackgroundWorkClass, number> = {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  }

  const admission: AdmissionConfig = {
    totalConcurrency: parsePositiveInteger(env.OPERATIONS_TOTAL_CONCURRENCY, {
      name: 'OPERATIONS_TOTAL_CONCURRENCY',
      fallback: 8,
      maximum: maxOperationsTotalConcurrency,
    }),
    interactiveReservation: parsePositiveInteger(env.OPERATIONS_INTERACTIVE_RESERVATION, {
      name: 'OPERATIONS_INTERACTIVE_RESERVATION',
      fallback: 2,
      maximum: 10_000,
    }),
    classConcurrency: Object.fromEntries(
      Object.entries(classEnvironment).map(([workClass, name]) => [
        workClass,
        parsePositiveInteger(env[name], {
          name,
          fallback: classDefaults[workClass as WorkClass],
          maximum: classMaximums[workClass as WorkClass] ?? 10_000,
        }),
      ]),
    ) as Record<WorkClass, number>,
    backgroundWeights: Object.fromEntries(
      Object.entries(weightEnvironment).map(([workClass, name]) => [
        workClass,
        parsePositiveInteger(env[name], {
          name,
          fallback: weightDefaults[workClass as BackgroundWorkClass],
          maximum: 10_000,
        }),
      ]),
    ) as Record<BackgroundWorkClass, number>,
  }

  // Retryable failures back off exponentially (2s, 6s, then capped at 15s by default) with +/-20% jitter so a
  // brief upstream hiccup is ridden out across four interactive attempts while the whole retry window stays
  // inside the ~30s the profile page waits for a refresh. Rate-limited work keeps its Retry-After delay.
  const retryDelayMs = parsePositiveInteger(env.OPERATIONS_RETRY_DELAY_MS, {
    name: 'OPERATIONS_RETRY_DELAY_MS',
    fallback: 2_000,
    maximum: 300_000,
  })

  const retryBackoff = {
    multiplier: parseBoundedInteger(env.OPERATIONS_RETRY_BACKOFF_MULTIPLIER, {
      name: 'OPERATIONS_RETRY_BACKOFF_MULTIPLIER',
      fallback: 3,
      minimum: 1,
      maximum: 10,
    }),
    maxDelayMs: parseBoundedInteger(env.OPERATIONS_RETRY_MAX_DELAY_MS, {
      name: 'OPERATIONS_RETRY_MAX_DELAY_MS',
      fallback: Math.max(15_000, retryDelayMs),
      minimum: retryDelayMs,
      maximum: 900_000,
    }),
    jitterRatio: 0.2,
  }

  // After a dead-lettered discovery reconciliation, wait 5 minutes (doubling per consecutive failure, capped at
  // an hour) before enqueueing another one instead of re-enqueueing on every scheduler tick.
  const reconciliationFailureBackoffMs = parseBoundedInteger(env.DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS, {
    name: 'DISCOVERY_RECONCILIATION_FAILURE_BACKOFF_MS',
    fallback: 5 * 60 * 1000,
    minimum: 60_000,
    maximum: 24 * 60 * 60 * 1000,
  })

  return {
    leaseMs: parsePositiveInteger(env.OPERATIONS_LEASE_MS, {
      name: 'OPERATIONS_LEASE_MS',
      fallback: 30_000,
      maximum: 300_000,
    }),
    pollMs: parsePositiveInteger(env.OPERATIONS_POLL_MS, {
      name: 'OPERATIONS_POLL_MS',
      fallback: 1_000,
      maximum: 60_000,
    }),
    retryDelayMs,
    retryBackoff,
    sourceUnavailableRetryMs: parseBoundedInteger(env.SOURCE_UNAVAILABLE_RETRY_MS, {
      name: 'SOURCE_UNAVAILABLE_RETRY_MS',
      fallback: 60_000,
      minimum: 1_000,
      maximum: 900_000,
    }),
    scheduleBatchSize: parsePositiveInteger(env.OPERATIONS_SCHEDULE_BATCH_SIZE, {
      name: 'OPERATIONS_SCHEDULE_BATCH_SIZE',
      fallback: 100,
      maximum: 1_000,
    }),
    // Exit (and let Docker restart the worker) when no loop has iterated for 10 minutes: every call is hung.
    stallTimeoutMs: parseBoundedInteger(env.OPERATIONS_STALL_TIMEOUT_MS, {
      name: 'OPERATIONS_STALL_TIMEOUT_MS',
      fallback: 10 * 60 * 1000,
      minimum: 60_000,
      maximum: 60 * 60 * 1000,
    }),
    // Worker statements are batched (discovery reconciliation streams ~188s as many short statements), so a
    // 5-minute per-statement and idle-in-transaction ceiling only ends sessions that are genuinely stuck.
    database: {
      connectTimeoutSeconds: parseBoundedInteger(env.OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS, {
        name: 'OPERATIONS_DATABASE_CONNECT_TIMEOUT_SECONDS',
        fallback: 10,
        minimum: 1,
        maximum: 120,
      }),
      statementTimeoutMs: parseBoundedInteger(env.OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS, {
        name: 'OPERATIONS_DATABASE_STATEMENT_TIMEOUT_MS',
        fallback: 5 * 60 * 1000,
        minimum: 1_000,
        maximum: 60 * 60 * 1000,
      }),
      idleInTransactionSessionTimeoutMs: parseBoundedInteger(env.OPERATIONS_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS, {
        name: 'OPERATIONS_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS',
        fallback: 5 * 60 * 1000,
        minimum: 1_000,
        maximum: 60 * 60 * 1000,
      }),
    } satisfies WorkerDatabaseSessionConfig,
    discovery: {
      // Full-snapshot reconciliation reads every player in long single statements; the worker-wide 5 min limit
      // cancelled it (SQLSTATE 57014) and turned it into a retry loop, so discovery sessions get their own ceiling.
      statementTimeoutMs: parseBoundedInteger(env.OPERATIONS_DISCOVERY_STATEMENT_TIMEOUT_MS, {
        name: 'OPERATIONS_DISCOVERY_STATEMENT_TIMEOUT_MS',
        fallback: 30 * 60 * 1000,
        minimum: 60_000,
        maximum: 2 * 60 * 60 * 1000,
      }),
      projectionBatchSize: parseBoundedInteger(env.DISCOVERY_PROJECTION_BATCH_SIZE, {
        name: 'DISCOVERY_PROJECTION_BATCH_SIZE',
        fallback: 500,
        minimum: 1,
        maximum: 1_000,
      }),
      reconciliationIntervalMs: parseBoundedInteger(env.DISCOVERY_RECONCILIATION_INTERVAL_MS, {
        name: 'DISCOVERY_RECONCILIATION_INTERVAL_MS',
        fallback: 60 * 60 * 1000,
        minimum: 60_000,
        maximum: 24 * 60 * 60 * 1000,
      }),
      reconciliationFailureBackoffMs,
      reconciliationMaxFailureBackoffMs: parseBoundedInteger(env.DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS, {
        name: 'DISCOVERY_RECONCILIATION_MAX_FAILURE_BACKOFF_MS',
        fallback: Math.max(60 * 60 * 1000, reconciliationFailureBackoffMs),
        minimum: reconciliationFailureBackoffMs,
        maximum: 24 * 60 * 60 * 1000,
      }),
    },
    leaderboard: {
      pageDepth: parsePositiveInteger(env.LEADERBOARD_PAGE_DEPTH, {
        name: 'LEADERBOARD_PAGE_DEPTH',
        fallback: defaultLeaderboardPageDepth,
        maximum: 20,
      }),
      intervalMs: parseBoundedInteger(env.LEADERBOARD_INTERVAL_MS, {
        name: 'LEADERBOARD_INTERVAL_MS',
        fallback: defaultLeaderboardIntervalMs,
        minimum: minLeaderboardIntervalMs,
        maximum: maxLeaderboardIntervalMs,
      }),
      firstDueAt: '2020-01-01T00:00:00.000Z',
    },
    rankingRetention: {
      enabled: strictBoolean(env.RANKING_RETENTION_ENABLED, true, 'RANKING_RETENTION_ENABLED'),
      retentionHours: parseBoundedInteger(env.RANKING_RETENTION_HOURS, {
        name: 'RANKING_RETENTION_HOURS',
        fallback: 24,
        minimum: minRankingRetentionHours,
        maximum: maxRankingRetentionHours,
      }),
      maxGenerations: parseBoundedInteger(env.RANKING_RETENTION_BATCH, {
        name: 'RANKING_RETENTION_BATCH',
        fallback: 20,
        minimum: 1,
        maximum: maxRankingRetentionBatch,
      }),
      intervalMs: 15 * 60 * 1000,
      firstDueAt: '2020-01-01T00:05:00.000Z',
    } satisfies RankingRetentionConfig,
    deepCrawl: {
      enabled: strictBoolean(env.DEEP_CRAWL_ENABLED, true, 'DEEP_CRAWL_ENABLED'),
      intervalMs: parseBoundedInteger(env.DEEP_CRAWL_INTERVAL_MS, {
        name: 'DEEP_CRAWL_INTERVAL_MS',
        fallback: 60 * 60 * 1000,
        minimum: minLeaderboardDeepCrawlIntervalMs,
        maximum: maxLeaderboardDeepCrawlIntervalMs,
      }),
      // Hourly windows start after the first 3-hour pass; regions then stay staggered across the hour.
      firstDueAt: '2026-10-07T19:30:00.000Z',
      pageDelayMs: parseBoundedInteger(env.DEEP_CRAWL_PAGE_DELAY_MS, {
        name: 'DEEP_CRAWL_PAGE_DELAY_MS',
        fallback: 150,
        minimum: 0,
        maximum: 5_000,
      }),
      soloIntervalMs: parseBoundedInteger(env.DEEP_CRAWL_SOLO_INTERVAL_MS, {
        name: 'DEEP_CRAWL_SOLO_INTERVAL_MS',
        fallback: 3 * 60 * 60 * 1000,
        minimum: minLeaderboardDeepCrawlIntervalMs,
        maximum: maxLeaderboardDeepCrawlIntervalMs,
      }),
      teamsIntervalMs: parseBoundedInteger(env.DEEP_CRAWL_TEAMS_INTERVAL_MS, {
        name: 'DEEP_CRAWL_TEAMS_INTERVAL_MS',
        fallback: 6 * 60 * 60 * 1000,
        minimum: minLeaderboardDeepCrawlIntervalMs,
        maximum: maxLeaderboardDeepCrawlIntervalMs,
      }),
    } satisfies LeaderboardDeepCrawlConfig,
    admission: validateAdmissionConfig(admission),
  }
}
