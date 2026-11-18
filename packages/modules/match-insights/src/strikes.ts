import type { HitEvent } from './line'
import { areEnemies, type MatchRecord, stateOf } from './record'
import { isClash, type Strike, strikeFromAttack, strikeFromClash, strikeFromThrow, thrownName } from './strike-sources'

// one strike per attack a player started, with the enemy hits it landed, so a multi-hit move counts once. a thrown
// weapon or item, like a spike ball or a mine, is a strike of its own, made by its first hit

export type { Strike, StrikeHit } from './strike-sources'

// a hit is the swing's when it comes from the weapon swung, or is the clash of two swings, which names no weapon.
// anything else came from something the attacker threw: a weapon (ThrowAxe, ThrowLance) or an item (SpikeBall)
function isSwingHit(hit: HitEvent, swing: Strike | undefined): swing is Strike {
  return swing !== undefined && (hit.weapon === swing.weapon || isClash(hit))
}

function moveEndStep(record: MatchRecord, strike: Strike, nextStep: number): number {
  const ended = stateOf(record, strike.attacker).move.find(([step, move]) => step > strike.step && move === '')

  return Math.min(ended?.[0] ?? nextStep, nextStep)
}

function closeSwings(record: MatchRecord, strikes: Strike[]) {
  const lastBySlot = new Map<number, Strike>()

  for (const strike of strikes) {
    if (strike.kind !== 'swing') continue

    const previous = lastBySlot.get(strike.attacker)

    if (previous) previous.endStep = moveEndStep(record, previous, strike.step)

    lastBySlot.set(strike.attacker, strike)
  }

  for (const strike of lastBySlot.values()) strike.endStep = moveEndStep(record, strike, record.endStep)
}

// a throw's hits on one step are one throw
function throwOf(strikes: Strike[], hit: HitEvent): Strike {
  const lastThrow = strikes.findLast((strike) => strike.kind === 'throw' && strike.attacker === hit.attacker)

  if (lastThrow?.step === hit.step && lastThrow.weapon === thrownName(hit).weapon) return lastThrow

  const thrown = strikeFromThrow(hit)

  strikes.push(thrown)

  return thrown
}

// a swing's hits belong to the attack its attacker started last
function ownerOf(record: MatchRecord, strikes: Strike[], open: Map<number, Strike>, hit: HitEvent): Strike {
  const swing = open.get(hit.attacker)

  if (isSwingHit(hit, swing)) return swing

  if (!isClash(hit)) return throwOf(strikes, hit)

  const clash = strikeFromClash(record, hit)

  strikes.push(clash)

  return clash
}

/** Every attack, throw and clash in the match, in time order, with the enemy hits each one landed. */
export function readStrikes(record: MatchRecord): Strike[] {
  const strikes: Strike[] = []
  const open = new Map<number, Strike>()

  for (const event of record.events) {
    if (event.type === 'attack') {
      const strike = strikeFromAttack(event)

      open.set(strike.attacker, strike)
      strikes.push(strike)
      continue
    }

    if (event.type !== 'hit' || !areEnemies(record, event.attacker, event.target)) continue

    const owner = ownerOf(record, strikes, open, event)

    owner.hits.push({ step: event.step, target: event.target, damage: event.damage })
  }

  closeSwings(record, strikes)

  return strikes
}
