import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

const int32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })
const positiveInt32 = int32.min(1)
const utcDateTime = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })
const visibleText = z
  .string()
  .min(1)
  .refine((value) => /[^\p{Separator}\p{Format}]/u.test(value))

const rankedValuesSchema = z
  .object({
    rating: int32,
    peakRating: int32,
    tier: visibleText,
    wins: int32,
    games: int32,
  })
  .strict()

const oneVsOneSchema = rankedValuesSchema
  .extend({
    region: visibleText,
    globalRank: positiveInt32.nullable(),
    regionRank: positiveInt32.nullable(),
  })
  .strict()

const rankedLegendSchema = rankedValuesSchema
  .extend({
    legendId: positiveInt32,
    legendNameKey: visibleText,
  })
  .strict()

const mainLegendSchema = z
  .object({
    legendId: positiveInt32,
    legendNameKey: visibleText,
    source: z.enum(['current-season', 'career']),
  })
  .strict()

const fixedTeamSchema = rankedValuesSchema
  .extend({
    brawlhallaIdOne: brawlhallaIdSchema,
    brawlhallaIdTwo: brawlhallaIdSchema,
    teamName: z.string(),
    region: visibleText,
    globalRank: positiveInt32.nullable(),
  })
  .strict()

const soloQueueSchema = rankedValuesSchema
  .extend({
    secondPlayerId: z.int().min(0).max(0).meta({ format: 'int32' }),
    teamName: z.string(),
    region: visibleText,
    globalRank: positiveInt32.nullable(),
  })
  .strict()

const ratingHistorySchema = rankedValuesSchema.extend({ recordedAt: utcDateTime }).strict()

export const playerRankedSnapshotSchema = z
  .object({
    oneVsOne: oneVsOneSchema,
    rankedLegends: z.array(rankedLegendSchema),
    mainLegend: mainLegendSchema.nullable(),
    fixedTeams: z.array(fixedTeamSchema),
    soloQueue: z.array(soloQueueSchema),
    ratingHistory: z.array(ratingHistorySchema),
  })
  .strict()
  .meta({ id: 'PlayerRankedSnapshot' })

export const playerRankedProfileSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    checkedAt: utcDateTime,
    lastSuccessAt: utcDateTime.nullable(),
    freshness: z.enum(['fresh', 'stale', 'unavailable']),
    freshForSeconds: z.int().min(3_600).max(3_600).meta({ format: 'int32' }),
    snapshot: playerRankedSnapshotSchema.nullable(),
  })
  .strict()
  .meta({ id: 'PlayerRankedProfile' })

export const nullablePlayerRankedProfileSchema = playerRankedProfileSchema.nullable()
export type PlayerRankedProfileContract = z.infer<typeof playerRankedProfileSchema>

export function parsePlayerRankedProfileOutput(value: unknown): PlayerRankedProfileContract | null {
  return nullablePlayerRankedProfileSchema.parse(value)
}
