import {
  type JobContract,
  type LeaderboardDeepCrawlPayload,
  type LeaderboardOperationKind,
  type LeaderboardOperationPayload,
  readPayloadObject,
  validateLeaderboardDeepCrawlPayload,
  validateLeaderboardOperationPayload,
} from '@brawltome/refresh-operations'

function parseLeaderboardPayload(value: unknown): LeaderboardOperationPayload {
  const payload = readPayloadObject(value, 'leaderboard') as LeaderboardOperationPayload

  return validateLeaderboardOperationPayload(payload)
}

export function leaderboardCollectionContract(
  kind: LeaderboardOperationKind,
): JobContract<LeaderboardOperationPayload> {
  return { kind, workClasses: ['leaderboard'], parsePayload: parseLeaderboardPayload }
}

function parseLeaderboardDeepCrawlPayload(value: unknown): LeaderboardDeepCrawlPayload {
  const payload = readPayloadObject(value, 'leaderboard deep crawl') as LeaderboardDeepCrawlPayload

  return validateLeaderboardDeepCrawlPayload(payload)
}

export const leaderboardDeepCrawlContract: JobContract<LeaderboardDeepCrawlPayload> = {
  kind: 'leaderboard-deep-crawl',
  workClasses: ['leaderboard'],
  parsePayload: parseLeaderboardDeepCrawlPayload,
}
