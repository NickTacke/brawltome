import type { PunishCause } from '@brawltome/contracts'
import type { Blow } from './blows'
import { type MatchRecord, stateOf } from './record'
import { lastBecameWithin, valueAt } from './series'

// how an opening came about, from the target's state at the step of the first hit

export const causeLabels: Record<PunishCause, string> = {
  whiff: 'Whiff punish',
  dodge: 'Dodge punish',
  stuffed: 'Beat their attack',
  landing: 'Landing catch',
  trade: 'Trade',
  reversal: 'Reversal',
  throw: 'Weapon throw',
  clean: 'Clean hit',
}

export const tradeSteps = 10
const dodgePunishSteps = 30
const whiffPunishSteps = 6
const landingSteps = 8

function didWhiffJustBefore(record: MatchRecord, target: number, step: number): boolean {
  const moves = stateOf(record, target).move

  if (valueAt(moves, step - 1, '').includes('Miss')) return true

  const index = moves.findLastIndex(([at]) => at < step)
  const [endedAt, current] = moves[index] ?? [0, '']
  const previous = moves[index - 1]?.[1] ?? ''

  return current === '' && previous.includes('Miss') && step - endedAt <= whiffPunishSteps
}

function isTrade(blow: Blow, blows: Blow[]): boolean {
  return blows.some(
    (other) =>
      other.attacker === blow.target &&
      other.target === blow.attacker &&
      Math.abs(other.step - blow.step) <= tradeSteps,
  )
}

// what the target was in the middle of: a dodge, an attack of their own, or landing
function stateCause(record: MatchRecord, blow: Blow): PunishCause {
  const state = stateOf(record, blow.target)
  const before = blow.step - 1
  const wasDodging = valueAt(state.dodging, before, false)
  const dodgeEnded = lastBecameWithin(state.dodging, false, blow.step - dodgePunishSteps, before)

  if (wasDodging || (dodgeEnded !== null && dodgeEnded > 0)) return 'dodge'

  const move = valueAt(state.move, before, '')

  if (move !== '' && !move.startsWith('ChargeThrow')) return 'stuffed'

  const landed = lastBecameWithin(state.inAir, false, blow.step - landingSteps, before)

  return landed === null ? 'clean' : 'landing'
}

export function openingCause(record: MatchRecord, blow: Blow, blows: Blow[], isReversal: boolean): PunishCause {
  if (blow.isThrow) return 'throw'

  if (isTrade(blow, blows)) return 'trade'

  if (isReversal) return 'reversal'

  if (didWhiffJustBefore(record, blow.target, blow.step)) return 'whiff'

  return stateCause(record, blow)
}
