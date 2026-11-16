import { z } from 'zod'
import type { Line } from './line'

// a player's counters as the game keeps them, under its own names: one object per weapon held, with one entry per
// move and the time it was held, beside the match-wide counts

const count = z.number().int().nonnegative()

const moveCountersSchema = z.object({
  Uses: count.default(0),
  EnemyHits: count.default(0),
  EnemyDamage: z.number().default(0),
  EnemyKOs: count.default(0),
  GCUses: count.default(0),
})

const weaponSkinSchema = z.object({ Weapon: z.string(), WeaponSkinName: z.string() })

const loadoutSchema = z.object({
  SkinName: z.string().optional(),
  ColorSchemeName: z.string().optional(),
  Stance: z.string().optional(),
  SidekickName: z.string().optional(),
  KOEffectName: z.string().optional(),
  WeaponSkin1: weaponSkinSchema.optional(),
  WeaponSkin2: weaponSkinSchema.optional(),
})

const countersSchema = z.object({
  DamageDealt: z.number(),
  DamageTaken: z.number(),
  KOs: count,
  Deaths: count,
  // ranked replays have no score
  Score: z.number().int().optional(),
  TimeInAir: z.number(),
  TimeOnGround: z.number(),
  TimeOnWall: z.number(),
  Dashes: count.default(0),
  TotalJumps: count.default(0),
  DashJumps: count.default(0),
  AirJumps: count.default(0),
  Clashes: count.default(0),
  Suicides: count.default(0),
  Loadout: loadoutSchema.default({}),
})

export type MoveCounters = z.infer<typeof moveCountersSchema>

export type WeaponCounters = {
  weapon: string
  heldMs: number
  damageTaken: number | null
  // the game's own move keys, such as nLight or GroundPound
  moves: [string, MoveCounters][]
}

export type PlayerStats = z.infer<typeof countersSchema> & { weapons: WeaponCounters[] }

// keys in a player's dump that are objects but not weapons
const notWeapons = new Set(['Loadout', 'Sequence'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function weaponOf(weapon: string, counters: Record<string, unknown>): WeaponCounters {
  const moves = Object.entries(counters)
    .filter((entry): entry is [string, Record<string, unknown>] => entry[0] !== 'null' && isObject(entry[1]))
    .map(([key, move]): [string, MoveCounters] => [key, moveCountersSchema.parse(move)])

  return {
    weapon,
    heldMs: typeof counters.TimeHeld === 'number' ? counters.TimeHeld : 0,
    damageTaken: typeof counters.DamageTaken === 'number' ? counters.DamageTaken : null,
    moves,
  }
}

/** A player's counters, with every object in their dump that isn't the loadout read as a weapon. */
export function readPlayerStats(line: Line, slot: number): PlayerStats {
  const dump = line.stats[`Player${slot}`]

  if (!isObject(dump)) throw new Error(`read stats for slot ${slot}: the line has no Player${slot}`)

  const weapons = Object.entries(dump)
    .filter((entry): entry is [string, Record<string, unknown>] => !notWeapons.has(entry[0]) && isObject(entry[1]))
    .map(([weapon, counters]) => weaponOf(weapon, counters))

  return { ...countersSchema.parse(dump), weapons }
}
