import {
  type DeadLetterHooks,
  type EffectDescriber,
  leaderboardOperationKinds,
  readLeaderboardEffects,
} from '@brawltome/refresh-operations'

const describeLeaderboardEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  leaderboardEffects: await readLeaderboardEffects(transaction, effectOperationId),
})

export const rankingDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(),
  describeEffects: new Map(leaderboardOperationKinds.map((kind) => [kind, describeLeaderboardEffects])),
}
