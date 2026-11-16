import type { Oddities } from '@brawltome/contracts'
import { dodgesOf, hitsOf, isChaseDodge } from './events'
import type { MatchFacts } from './facts'
import { pressesBetween } from './inputs'
import { isLive, sideOf, stateOf, statsOf } from './record'
import { valueAt } from './series'

// the small counts that are fun to know: mashing in hitstun, chase dodges, gravity cancels, the longest airtime

function countGravityCancels(facts: MatchFacts, slot: number): number {
  const moves = statsOf(facts.record, slot).weapons.flatMap((weapon) => weapon.moves)

  return moves.reduce((total, [, counters]) => total + counters.GCUses, 0)
}

function stunnedSteps(hitstun: [number, boolean][]): number {
  return hitstun.reduce((total, [step, isStunned], index) => {
    const until = hitstun[index + 1]?.[0] ?? step

    return isStunned ? total + until - step : total
  }, 0)
}

function mashPerSecond(facts: MatchFacts, slot: number): number {
  const state = stateOf(facts.record, slot)
  let presses = 0
  let previousBits = 0

  for (const [step, bits] of state.input) {
    if (valueAt(state.hitstun, step, false)) presses += pressesBetween(previousBits, bits)

    previousBits = bits
  }

  const seconds = (stunnedSteps(state.hitstun) * facts.record.stepMs) / 1000

  return seconds > 0 ? presses / seconds : 0
}

function longestAirMs(facts: MatchFacts, slot: number): number {
  const inAir = stateOf(facts.record, slot).inAir
  let longestSteps = 0

  for (const [index, [step, isUp]] of inAir.entries()) {
    const until = inAir[index + 1]?.[0] ?? step
    const isInPlay = isLive(facts.record, slot, step) && isLive(facts.record, slot, until)

    if (isUp && isInPlay) longestSteps = Math.max(longestSteps, until - step)
  }

  return longestSteps * facts.record.stepMs
}

function friendlyDamage(facts: MatchFacts, slot: number): number {
  const { record } = facts

  const hits = hitsOf(record).filter(
    (hit) => hit.attacker === slot && hit.target !== slot && sideOf(record, hit.target) === sideOf(record, slot),
  )

  return hits.reduce((total, hit) => total + hit.damage, 0)
}

export function readOddities(facts: MatchFacts, slot: number): Oddities {
  const own = facts.strikes.filter((strike) => strike.attacker === slot)
  const swings = own.filter((strike) => !strike.isThrow)

  return {
    chaseDodges: dodgesOf(facts.record, slot).filter(isChaseDodge).length,
    gravityCancels: countGravityCancels(facts, slot),
    mashPerSecond: mashPerSecond(facts, slot),
    longestAirMs: longestAirMs(facts, slot),
    swings: swings.length,
    swingsHit: swings.filter((strike) => strike.hits.length > 0).length,
    throwsHit: own.filter((strike) => strike.isThrow).length,
    friendlyDamage: friendlyDamage(facts, slot),
  }
}
