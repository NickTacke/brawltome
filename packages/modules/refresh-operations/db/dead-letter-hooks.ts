import type { DeadLetterInspection } from '../model'
import type { Transaction } from './transaction'

export type DeadLetterEffects = Pick<
  DeadLetterInspection,
  'proofEffects' | 'interactiveEffects' | 'leaderboardEffects' | 'statisticsEffects' | 'statisticsPublicationEffects'
>

export type EffectDescriber = (
  transaction: Transaction,
  effectOperationId: string,
) => Promise<Partial<DeadLetterEffects>>

export type ReplayGuardTarget = { kind: string; effectOperationId: string }

export type ReplayGuard = (transaction: Transaction, target: ReplayGuardTarget) => Promise<void>

/**
 * What the owners of each kind add to the operator's dead letter commands. A kind with no describer lists no effects,
 * and a kind with no guard can always be disposed. A guard runs for a replay and a discard alike.
 */
export type DeadLetterHooks = {
  replayGuards: Map<string, ReplayGuard>
  describeEffects: Map<string, EffectDescriber>
}
