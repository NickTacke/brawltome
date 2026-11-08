import { type DeadLetterHooks, type EffectDescriber, readInteractiveEffects } from '@brawltome/refresh-operations'

const playerRefreshKinds = ['interactive-player-refresh', 'ranked-player-pulse', 'player-name-verification']

const describeSectionEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  interactiveEffects: await readInteractiveEffects(transaction, effectOperationId),
})

export const playerDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(),
  describeEffects: new Map(playerRefreshKinds.map((kind) => [kind, describeSectionEffects])),
}
