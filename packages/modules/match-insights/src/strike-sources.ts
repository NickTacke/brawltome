import type { AttackEvent, HitEvent } from './line'
import { moveLabel } from './move-names'
import { type MatchRecord, stateOf } from './record'
import { valueAt } from './series'

// where a strike comes from: an attack a player started, something they threw, or a clash that met no swing of theirs

export type StrikeHit = { step: number; target: number; damage: number }

export type Strike = {
  attacker: number
  // a swing is an attack; a throw is a thrown weapon or item; a clash is two hits meeting
  kind: 'swing' | 'throw' | 'clash'
  step: number
  // the step the attacker was free again: their move ended, or the next attack began
  endStep: number
  weapon: string
  move: string
  isSignature: boolean
  hits: StrikeHit[]
}

// the game names no weapon for a clash
export function isClash(hit: HitEvent): boolean {
  return hit.move.startsWith('Clash')
}

// a thrown weapon names itself after its icon, so a thrown Rocket Lance hits as ThrowLance
const thrownWeapons: Record<string, string> = { Lance: 'RocketLance' }

export function thrownName(hit: HitEvent): { weapon: string; move: string } {
  if (!hit.weapon.startsWith('Throw')) return { weapon: hit.weapon, move: moveLabel(hit.move) }

  const name = hit.weapon.slice('Throw'.length)

  return { weapon: thrownWeapons[name] ?? name, move: 'Throw' }
}

export function strikeFromAttack(attack: AttackEvent): Strike {
  return {
    attacker: attack.player,
    kind: 'swing',
    step: attack.step,
    endStep: attack.step,
    weapon: attack.weapon,
    move: moveLabel(attack.move),
    isSignature: attack.signature,
    hits: [],
  }
}

export function strikeFromThrow(hit: HitEvent): Strike {
  return {
    attacker: hit.attacker,
    kind: 'throw',
    step: hit.step,
    endStep: hit.step,
    ...thrownName(hit),
    isSignature: false,
    hits: [],
  }
}

// a clash with no swing of the attacker's open was made with whatever they held
export function strikeFromClash(record: MatchRecord, hit: HitEvent): Strike {
  const weapon = valueAt(stateOf(record, hit.attacker).weapon, hit.step, '')

  return {
    attacker: hit.attacker,
    kind: 'clash',
    step: hit.step,
    endStep: hit.step,
    weapon,
    move: 'Clash',
    isSignature: false,
    hits: [],
  }
}
