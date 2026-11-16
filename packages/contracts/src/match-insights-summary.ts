import { z } from './zod'

// what a match line says about each player: the game's own counters, and the loadout and movement read beside them

const count = z.number().int().nonnegative()
const slot = z.number().int().min(1)
const timeMs = z.number().int().nonnegative()

// one move of one weapon, under the game's counters. hits counts every enemy hit, so a multi-hit move can have more
// hits than uses
const moveRowSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    weapon: z.string(),
    uses: count,
    hits: count,
    damage: z.number(),
    kos: count,
    gravityCancels: count,
  })
  .strict()

const weaponRowSchema = z
  .object({ weapon: z.string(), label: z.string(), isWeapon: z.boolean(), heldMs: timeMs, damage: z.number() })
  .strict()

const summaryPlayerSchema = z
  .object({
    slot,
    brawlhallaId: z.number().int(),
    name: z.string(),
    legendKey: z.string(),
    legendName: z.string(),
    // the team in a team match, the player's own slot otherwise
    side: z.number().int(),
    // the side that fell least won; ranked replays have no score to tell
    isWinner: z.boolean(),
    stocksLeft: count,
    score: z.number().int().nullable(),
    kos: count,
    falls: count,
    damageDealt: z.number(),
    damageTaken: z.number(),
    attacks: count,
    // the moves' hits, each move's counted at most once per use
    hits: count,
    dodges: count,
    dodgeDirections: z.record(z.string(), count),
    airShare: z.number(),
    groundShare: z.number(),
    wallShare: z.number(),
    damagePerMinute: z.number(),
    dodgesPerMinute: z.number(),
    damageTakenPerFall: z.number().nullable(),
    // most held first
    weapons: z.array(weaponRowSchema),
    // most damage first
    moves: z.array(moveRowSchema),
  })
  .strict()

const summaryKoSchema = z.object({ timeMs, victim: slot, killer: slot.nullable(), damage: z.number() }).strict()

export const insightSummarySchema = z
  .object({
    mapId: z.number().int(),
    mapName: z.string(),
    modeName: z.string(),
    patch: z.string(),
    durationMs: timeMs,
    players: z.array(summaryPlayerSchema),
    kos: z.array(summaryKoSchema),
  })
  .strict()

const playerExtrasSchema = z
  .object({
    slot,
    team: z.number().int(),
    // [ms, weapon held from then on]
    weaponSeries: z.array(z.tuple([z.number().int(), z.string()])),
    dashes: count,
    jumps: count,
    dashJumps: count,
    airJumps: count,
    clashes: count,
    suicides: count,
    pickups: count,
    throws: count,
    inputsPerMinute: z.number(),
    spotDodges: count,
    // the game's own key for the stance, which also names its icon
    stanceKey: z.string(),
    stance: z.string(),
    skin: z.string(),
    colour: z.string(),
    weaponSkins: z.array(z.object({ weapon: z.string(), name: z.string() }).strict()),
    sidekick: z.string(),
    koEffect: z.string(),
    damageTakenByWeapon: z.record(z.string(), z.number()),
  })
  .strict()

export const insightExtrasSchema = z
  .object({
    queue: z.string().nullable(),
    isRanked: z.boolean(),
    stocks: count.nullable(),
    isReliable: z.boolean(),
    players: z.array(playerExtrasSchema),
  })
  .strict()

export type MoveRow = z.infer<typeof moveRowSchema>
export type WeaponRow = z.infer<typeof weaponRowSchema>
export type SummaryPlayer = z.infer<typeof summaryPlayerSchema>
export type SummaryKo = z.infer<typeof summaryKoSchema>
export type InsightSummary = z.infer<typeof insightSummarySchema>
export type PlayerExtras = z.infer<typeof playerExtrasSchema>
export type InsightExtras = z.infer<typeof insightExtrasSchema>
