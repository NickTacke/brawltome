export const minRankingRetentionHours = 24
export const maxRankingRetentionHours = 365 * 24
export const maxRankingRetentionBatch = 200

export type RankingRetentionAuthorization = {
  operationId: string
  leaseOwner: string
  leaseToken: number
}

export type RankingRetentionInput = {
  retentionHours: number
  maxGenerations: number
}

export type RankingRetentionResult = { outcome: 'expired'; deletedGenerations: number } | { outcome: 'lease-lost' }

export interface RankingRetentionStore {
  expireGenerations(
    authorization: RankingRetentionAuthorization,
    input: RankingRetentionInput,
  ): Promise<RankingRetentionResult>
}

export function validateRankingRetentionInput(input: RankingRetentionInput): RankingRetentionInput {
  if (
    !Number.isSafeInteger(input.retentionHours) ||
    input.retentionHours < minRankingRetentionHours ||
    input.retentionHours > maxRankingRetentionHours
  ) {
    throw new Error(
      `ranking retention hours must be an integer between ${minRankingRetentionHours} and ${maxRankingRetentionHours}`,
    )
  }
  if (
    !Number.isSafeInteger(input.maxGenerations) ||
    input.maxGenerations < 1 ||
    input.maxGenerations > maxRankingRetentionBatch
  ) {
    throw new Error(`ranking retention batch must be an integer between 1 and ${maxRankingRetentionBatch}`)
  }
  return input
}
