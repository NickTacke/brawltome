import { type DeadLetterHooks, type EffectDescriber, leaderboardOperationKinds } from '@brawltome/queue'
import { readLeaderboardEffects } from '../db/leaderboard-effects'

const describeLeaderboardEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  leaderboardEffects: await readLeaderboardEffects(transaction, effectOperationId),
})

export const rankingDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(),
  describeEffects: new Map(leaderboardOperationKinds.map((kind) => [kind, describeLeaderboardEffects])),
}
