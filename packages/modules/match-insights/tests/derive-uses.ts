import { eventsOf, type RawEvent, type RawLine } from './derive'
import { swingsOf, thrownHits } from './derive-swings'

// each move's uses and the uses that landed, counted from the attack, throw and hit events. a move is keyed the way
// the game keys its own counters, so the uses can be checked against them

// the internal name starts with the weapon in the game's naming; the rest is checked in this order
const keyPrefixes: [string, string][] = [
  ['SmashNeutral', 'nHeavy'],
  ['SmashUp', 'nHeavy'],
  ['SmashSide', 'sHeavy'],
  ['SmashDown', 'dHeavy'],
  ['AirUpHeavy', 'Recovery'],
  ['GroundPound', 'GroundPound'],
  ['AirDown', 'dAir'],
  ['AirSide', 'sAir'],
  ['Air', 'nAir'],
  ['Neutral', 'nLight'],
  ['Side', 'sLight'],
  ['Down', 'dLight'],
]

// a greatsword string (DNBridge, NN2Ender, SGCEnder) counts as the light attack of its last direction
function counterKeyOf(move: string): string {
  const rest = move.replace(/^[A-Z][a-z]+/, '')
  const string = /([NSD])\d*(?:GC)?(?:Bridge|Ender)$/.exec(rest)

  if (string) return `${string[1]?.toLowerCase()}Light`

  return keyPrefixes.find(([prefix]) => rest.startsWith(prefix))?.[1] ?? rest
}

// a thrown weapon hits as ThrowAxe or ThrowLance; an item hits under its own name
function thrownWeapon(hit: RawEvent): string {
  const name = String(hit.weapon).replace(/^Throw/, '')

  return name === 'Lance' ? 'RocketLance' : name
}

export type CountedUses = Map<string, { uses: number; landed: number }>

function add(counts: CountedUses, key: string, uses: number, landed: number) {
  const current = counts.get(key) ?? { uses: 0, landed: 0 }

  counts.set(key, { uses: current.uses + uses, landed: current.landed + landed })
}

/** Uses and uses landed per `Weapon.key`, throws under `Weapon.Throw`. */
export function countedUses(line: RawLine, slot: number): CountedUses {
  const counts: CountedUses = new Map()

  for (const swing of swingsOf(line, slot)) {
    add(counts, `${swing.attack.weapon}.${counterKeyOf(String(swing.attack.move))}`, 1, swing.isLanded ? 1 : 0)
  }

  for (const thrown of eventsOf(line, 'throw').filter((event) => event.player === slot)) {
    add(counts, `${thrown.weapon}.Throw`, 1, 0)
  }

  const landedThrows = new Set(thrownHits(line, slot).map((hit) => `${hit.step} ${thrownWeapon(hit)}`))

  for (const landed of landedThrows) add(counts, `${landed.split(' ')[1]}.Throw`, 0, 1)

  return counts
}
