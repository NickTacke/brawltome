import { type DeadLetterHooks, type EffectDescriber, readInteractiveEffects } from '@brawltome/refresh-operations'

const describeSectionEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  interactiveEffects: await readInteractiveEffects(transaction, effectOperationId),
})

export const clanDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(),
  describeEffects: new Map([['clan-refresh', describeSectionEffects]]),
}
