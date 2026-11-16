import { eventsOf, type RawLine, statsOf } from './derive'

// the game's own counters per move and weapon, read straight from a player's stats, and the events counted beside them

type MoveCounters = { Uses?: number; EnemyHits?: number; EnemyDamage?: number; EnemyKOs?: number; GCUses?: number }

export type CountedMove = { key: string; uses: number; hits: number; damage: number; kos: number }

export type CountedWeapon = { weapon: string; heldMs: number; damage: number }

function weaponEntries(line: RawLine, slot: number): [string, Record<string, unknown>][] {
  return Object.entries(statsOf(line, slot)).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      entry[0] !== 'Loadout' && entry[0] !== 'Sequence' && typeof entry[1] === 'object' && entry[1] !== null,
  )
}

function movesOfWeapon(weapon: string, counters: Record<string, unknown>): CountedMove[] {
  return Object.entries(counters)
    .filter(([key, value]) => key !== 'null' && typeof value === 'object' && value !== null)
    .map(([key, value]) => {
      const move = value as MoveCounters
      const uses = move.Uses ?? 0

      return {
        key: `${weapon}.${key}`,
        uses,
        hits: move.EnemyHits ?? 0,
        damage: move.EnemyDamage ?? 0,
        kos: move.EnemyKOs ?? 0,
      }
    })
}

export function countedMoves(line: RawLine, slot: number): CountedMove[] {
  return weaponEntries(line, slot).flatMap(([weapon, counters]) => movesOfWeapon(weapon, counters))
}

export function countedWeapons(line: RawLine, slot: number): CountedWeapon[] {
  return weaponEntries(line, slot).map(([weapon, counters]) => {
    const moves = movesOfWeapon(weapon, counters)
    const heldMs = typeof counters.TimeHeld === 'number' ? counters.TimeHeld : 0

    return { weapon, heldMs, damage: moves.reduce((total, move) => total + move.damage, 0) }
  })
}

export function countedGravityCancels(line: RawLine, slot: number): number {
  const counters = weaponEntries(line, slot).flatMap(([, moves]) => Object.values(moves))

  return counters.reduce((total: number, move) => total + ((move as MoveCounters | null)?.GCUses ?? 0), 0)
}

function statNumber(line: RawLine, slot: number, key: string): number {
  const value = statsOf(line, slot)[key]

  return typeof value === 'number' ? value : 0
}

export function countedMovement(line: RawLine, slot: number) {
  const own = line.timeline.events.filter((event) => event.player === slot)
  const dodges = own.filter((event) => event.type === 'dodge')

  return {
    dashes: statNumber(line, slot, 'Dashes'),
    jumps: statNumber(line, slot, 'TotalJumps'),
    airJumps: statNumber(line, slot, 'AirJumps'),
    dashJumps: statNumber(line, slot, 'DashJumps'),
    clashes: statNumber(line, slot, 'Clashes'),
    suicides: statNumber(line, slot, 'Suicides'),
    pickups: own.filter((event) => event.type === 'pickup').length,
    throws: own.filter((event) => event.type === 'throw').length,
    dodges: dodges.length,
    spotDodges: dodges.filter((event) => !(event as { direction?: string }).direction).length,
    chaseDodges: dodges.filter((event) => String(event.kind).startsWith('Fast')).length,
  }
}

export function countedEvents(line: RawLine, type: string, slot: number): number {
  return eventsOf(line, type).filter((event) => event.player === slot).length
}
