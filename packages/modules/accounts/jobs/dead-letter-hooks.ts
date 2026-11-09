import type { DeadLetterHooks, EffectDescriber } from '@brawltome/queue'
import { readProofEffects } from '../db/proof-effects'

const describeProofEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  proofEffects: await readProofEffects(transaction, effectOperationId),
})

// proof rows from before the kind was split are still around, and replays copy their stored kind
export const accountsDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(),
  describeEffects: new Map([
    ['proof', describeProofEffects],
    ['primary-player-verification', describeProofEffects],
  ]),
}
