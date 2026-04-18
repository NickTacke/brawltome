// Minimal typed loader for the Brawlhalla in-game stats dump. This format
// is only available to spectators, so we use it solely as ground truth for
// offline validation of the simulator.
//
// The `Sequence` array interleaves weapon-change events (`i: "Hammer"`,
// `i: "Unarmed"`, ...) with damage checkpoints (`d: 123.45`). We only
// extract the weapon timeline here; damage totals are read from the
// per-player `DamageDealt` / `DamageTaken` fields directly.

import { readFileSync } from 'node:fs'

type SequenceEntry = {
  t: number
  d?: number
  i?: string
}

export type StatsPlayer = {
  PlayerName: string
  TeamNum: number
  KOs: number
  Deaths: number
  DamageDealt: number
  DamageTaken: number
  TimeInAir: number
  TimeOnGround: number
  TimeOnWall: number
  Loadout: {
    LegendName: string
    LegendID: number
  }
  Sequence: SequenceEntry[]
}

export type StatsDump = {
  BuildVersion: string
  GameMode: string
  MapName: string
  MapID: number
  GameDuration: number
  Lives: number
  Teams: boolean
  // Up to 8 players, keyed Player1..Player8.
  [playerKey: string]: unknown
}

export function loadStats(path: string): StatsDump {
  return JSON.parse(readFileSync(path, 'utf8')) as StatsDump
}

export function statsPlayers(stats: StatsDump): StatsPlayer[] {
  const out: StatsPlayer[] = []
  for (let i = 1; i <= 8; i++) {
    const p = stats[`Player${i}`]
    if (p && typeof p === 'object') out.push(p as StatsPlayer)
  }
  return out
}

// Weapon names in the stats JSON use "Unarmed" where we use "Base". This
// helper normalises to the power-name prefix convention the simulator uses.
export function normaliseWeaponName(raw: string): string {
  return raw === 'Unarmed' ? 'Base' : raw
}

// Returns the weapon the player was holding at time `ms` according to
// the stats dump's Sequence. Defaults to 'Base' before the first `i`
// entry appears.
export function weaponAtMs(seq: readonly SequenceEntry[], ms: number): string {
  let current = 'Base'
  for (const e of seq) {
    if (e.t > ms) break
    if (e.i) current = normaliseWeaponName(e.i)
  }
  return current
}
