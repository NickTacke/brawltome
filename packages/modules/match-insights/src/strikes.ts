import type { AttackEvent, HitEvent } from './line'
import { moveLabel } from './move-names'
import { areEnemies, type MatchRecord, stateOf } from './record'

// one strike per attack a player started, with the enemy hits it landed, so a multi-hit move counts once. a thrown
// weapon or item, like a spike ball or a mine, is a strike of its own, made by its first hit

export type StrikeHit = { step: number; target: number; damage: number }

export type Strike = {
  attacker: number
  step: number
  // the step the attacker was free again: their move ended, or the next attack began
  endStep: number
  weapon: string
  move: string
  isSignature: boolean
  isThrow: boolean
  hits: StrikeHit[]
}

// a hit is the swing's when it comes from the weapon swung, or is the clash of two swings, which names no weapon.
// anything else came from something the attacker threw: a weapon (ThrowAxe, ThrowLance) or an item (SpikeBall)
function isSwingHit(hit: HitEvent, swing: Strike | undefined): swing is Strike {
  return swing !== undefined && (hit.weapon === swing.weapon || hit.move.startsWith('Clash'))
}

// a thrown weapon names itself after its icon, so a thrown Rocket Lance hits as ThrowLance
const thrownWeapons: Record<string, string> = { Lance: 'RocketLance' }

function thrownName(hit: HitEvent): { weapon: string; move: string } {
  if (hit.weapon.startsWith('Throw')) {
    const name = hit.weapon.slice('Throw'.length)

    return { weapon: thrownWeapons[name] ?? name, move: 'Throw' }
  }

  return { weapon: hit.weapon, move: moveLabel(hit.move) }
}

function strikeFromAttack(attack: AttackEvent): Strike {
  return {
    attacker: attack.player,
    step: attack.step,
    endStep: attack.step,
    weapon: attack.weapon,
    move: moveLabel(attack.move),
    isSignature: attack.signature,
    isThrow: false,
    hits: [],
  }
}

function strikeFromThrow(hit: HitEvent): Strike {
  return {
    attacker: hit.attacker,
    step: hit.step,
    endStep: hit.step,
    ...thrownName(hit),
    isSignature: false,
    isThrow: true,
    hits: [],
  }
}

function moveEndStep(record: MatchRecord, strike: Strike, nextStep: number): number {
  const ended = stateOf(record, strike.attacker).move.find(([step, move]) => step > strike.step && move === '')

  return Math.min(ended?.[0] ?? nextStep, nextStep)
}

function closeStrikes(record: MatchRecord, strikes: Strike[]) {
  const lastBySlot = new Map<number, Strike>()

  for (const strike of strikes) {
    if (strike.isThrow) continue

    const previous = lastBySlot.get(strike.attacker)

    if (previous) previous.endStep = moveEndStep(record, previous, strike.step)

    lastBySlot.set(strike.attacker, strike)
  }

  for (const strike of lastBySlot.values()) strike.endStep = moveEndStep(record, strike, record.endStep)
}

// a swing's hits belong to the attack its attacker started last; a throw's hits on one step are one throw
function ownerOf(strikes: Strike[], open: Map<number, Strike>, hit: HitEvent): Strike {
  const swing = open.get(hit.attacker)

  if (isSwingHit(hit, swing)) return swing

  const lastThrow = strikes.findLast((strike) => strike.isThrow && strike.attacker === hit.attacker)

  if (lastThrow?.step === hit.step && lastThrow.weapon === thrownName(hit).weapon) return lastThrow

  const thrown = strikeFromThrow(hit)

  strikes.push(thrown)

  return thrown
}

/** Every attack and thrown weapon in the match, in time order, with the enemy hits each one landed. */
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

    const owner = ownerOf(strikes, open, event)

    owner.hits.push({ step: event.step, target: event.target, damage: event.damage })
  }

  closeStrikes(record, strikes)

  return strikes
}
