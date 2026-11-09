import {
  type JobContract,
  type RankingRetentionPayload,
  readPayloadObject,
  validateRankingRetentionPayload,
} from '@brawltome/refresh-operations'

function parseRankingRetentionPayload(value: unknown): RankingRetentionPayload {
  const payload = readPayloadObject(value, 'ranking retention') as RankingRetentionPayload

  return validateRankingRetentionPayload(payload)
}

export const rankingRetentionContract: JobContract<RankingRetentionPayload> = {
  kind: 'ranking-retention',
  workClasses: ['maintenance'],
  parsePayload: parseRankingRetentionPayload,
}
