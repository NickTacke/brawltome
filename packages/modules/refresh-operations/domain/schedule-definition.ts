import {
  type CreateSchedule,
  type LeaderboardDeepCrawlPayload,
  type primaryMonitoringIntervalMs,
  validateLeaderboardDeepCrawlPayload,
  validateLeaderboardOperationPayload,
  validateRankingRetentionPayload,
} from '../model'
import { isLeaderboardKind } from './operation-kinds'

const utcDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export type PrimaryMonitoringScheduleDefinition = {
  kind: 'interactive-player-refresh'
  scheduleKey: string
  operationKeyPrefix: string
  resourceKey: string
  workClass: 'primary-monitoring'
  intervalMs: typeof primaryMonitoringIntervalMs
  firstDueAt: string
  payload: {
    assignmentId: string
    brawlhallaId: number
    staleSections: ['ranked', 'stats']
  }
  provenance: { source: string; requestedBy: string }
  maxAttempts: number
}

function parseFirstDueAt(value: string): Date {
  if (!utcDateTime.test(value)) throw new Error('firstDueAt must be an ISO-8601 UTC timestamp ending in Z')

  const parsed = new Date(value)

  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
  )

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error('firstDueAt must be a valid timestamp')
  }

  return parsed
}

function validateScheduleIdentity(input: {
  scheduleKey: string
  operationKeyPrefix: string
  intervalMs: number
  firstDueAt: string
}): Date {
  if (!input.scheduleKey || input.scheduleKey.length > 200) {
    throw new Error('scheduleKey must contain between 1 and 200 characters')
  }

  if (!input.operationKeyPrefix || input.operationKeyPrefix.length > 200) {
    throw new Error('operationKeyPrefix must contain between 1 and 200 characters')
  }

  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error('intervalMs must be a positive safe integer')
  }

  return parseFirstDueAt(input.firstDueAt)
}

export function validateSchedule(input: CreateSchedule): Date {
  const firstDueAt = validateScheduleIdentity(input)
  const kind = input.kind ?? 'proof'

  if (isLeaderboardKind(kind)) {
    const payload = validateLeaderboardOperationPayload(input.payload as { pageDepth: number; intervalMs: number })

    if (payload.intervalMs !== input.intervalMs) {
      throw new Error('leaderboard payload intervalMs must match the schedule intervalMs')
    }
  }

  if (kind === 'ranking-retention') {
    if (input.workClass !== 'maintenance') throw new Error('ranking retention requires maintenance work class')

    validateRankingRetentionPayload(input.payload as { retentionHours: number; maxGenerations: number })
  }

  if (kind === 'leaderboard-deep-crawl') {
    if (input.workClass !== 'leaderboard') throw new Error('leaderboard deep crawl requires leaderboard work class')

    const payload = validateLeaderboardDeepCrawlPayload(input.payload as LeaderboardDeepCrawlPayload)

    if (payload.intervalMs !== input.intervalMs) {
      throw new Error('leaderboard deep crawl payload intervalMs must match the schedule intervalMs')
    }
  }

  return firstDueAt
}

export function validatePrimaryMonitoringSchedule(input: PrimaryMonitoringScheduleDefinition): Date {
  const firstDueAt = validateScheduleIdentity(input)
  const { payload } = input

  if (input.resourceKey !== `player:${payload.brawlhallaId}`) {
    throw new Error('Primary monitoring requires a canonical player resource key')
  }

  if (!Number.isSafeInteger(payload.brawlhallaId) || payload.brawlhallaId <= 0) {
    throw new Error('Primary monitoring requires a positive safe Brawlhalla ID')
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.assignmentId)) {
    throw new Error('Primary monitoring requires a UUID assignmentId')
  }

  return firstDueAt
}
