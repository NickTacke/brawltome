import { knockoutSchema, punishCauses } from './match-insights-moments'
import { z } from './zod'

// what each player did over the match beyond the game's counters: neutral, habits, stocks and the odd small count

const count = z.number().int().nonnegative()
const slot = z.number().int().min(1)
const timeMs = z.number().int().nonnegative()

const causeRecordSchema = z
  .object({
    cause: z.enum(punishCauses),
    label: z.string(),
    won: count,
    lost: count,
    damageWon: z.number(),
    damageLost: z.number(),
  })
  .strict()

const neutralStatsSchema = z
  .object({
    openingsWon: count,
    openingsLost: count,
    damagePerOpening: z.number(),
    hitsPerOpening: z.number(),
    longestString: count,
    biggestPunish: z.number(),
    // openings needed for each KO; null without a KO
    openingsPerKo: z.number().nullable(),
    // links between hits the target could do nothing about, out of all links; null without a second hit
    trueLinkShare: z.number().nullable(),
    killChances: count,
    killConversions: count,
    // own punishes the target ended by hitting back
    timesReversed: count,
    causes: z.array(causeRecordSchema),
  })
  .strict()

const habitOptionSchema = z
  .object({ key: z.string(), label: z.string(), count, punished: count, costDamage: z.number() })
  .strict()

// costStep names the punish a moment led to, so two moments that led to the same one can be told apart
const habitMomentSchema = z
  .object({ timeMs, option: z.string(), costDamage: z.number(), costStep: z.number().int().nullable() })
  .strict()

// how often a player picked each option in one situation, and what the pick cost them
const habitSchema = z
  .object({
    key: z.string(),
    situation: z.string(),
    // what a count is: a number of moments, or seconds spent
    unit: z.enum(['times', 'seconds']),
    // a bar of options, or the nine dodge directions on a pad
    layout: z.enum(['bar', 'pad']),
    options: z.array(habitOptionSchema),
    total: count,
    // the most picked option; for a habit counted in seconds, the first option, which the habit is about
    top: habitOptionSchema.nullable(),
    share: z.number(),
    // the times a pick was punished and what that cost: over every option, or the top one's for seconds
    punished: count,
    costDamage: z.number(),
    isFlagged: z.boolean(),
    moments: z.array(habitMomentSchema),
  })
  .strict()

const odditiesSchema = z
  .object({
    chaseDodges: count,
    gravityCancels: count,
    // button presses per second while stunned
    mashPerSecond: z.number(),
    longestAirMs: timeMs,
    swings: count,
    swingsHit: count,
    throwsHit: count,
    friendlyDamage: z.number(),
  })
  .strict()

// one life: from respawning until the next KO or the end of the match
const stockSchema = z
  .object({
    slot,
    index: count,
    startMs: timeMs,
    endMs: timeMs,
    isKo: z.boolean(),
    // [ms, damage taken so far in this life]
    tape: z.array(z.tuple([timeMs, z.number()])),
    damageTaken: z.number(),
    damageDealt: z.number(),
    openingsWon: count,
    openingsLost: count,
    knockout: knockoutSchema.nullable(),
  })
  .strict()

export const playerInsightSchema = z
  .object({
    slot,
    neutral: neutralStatsSchema,
    habits: z.array(habitSchema),
    stocks: z.array(stockSchema),
    oddities: odditiesSchema,
  })
  .strict()

export type CauseRecord = z.infer<typeof causeRecordSchema>
export type NeutralStats = z.infer<typeof neutralStatsSchema>
export type HabitOption = z.infer<typeof habitOptionSchema>
export type HabitMoment = z.infer<typeof habitMomentSchema>
export type Habit = z.infer<typeof habitSchema>
export type Oddities = z.infer<typeof odditiesSchema>
export type Stock = z.infer<typeof stockSchema>
export type PlayerInsight = z.infer<typeof playerInsightSchema>
