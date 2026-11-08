import {
  type CreateSchedule,
  type LeaderboardDeepCrawlPayload,
  validateLeaderboardDeepCrawlPayload,
  validateLeaderboardOperationPayload,
  validateRankingRetentionPayload,
} from '../model'
import { isLeaderboardKind } from './operation-kinds'

const utcDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

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

export function validateScheduleIdentity(input: {
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
