import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

const int32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })
const signedInt32 = z.int().min(-2_147_483_647).max(2_147_483_647).meta({ format: 'int32' })
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

const observedRatingDirectionSchema = z
  .object({
    direction: z.enum(['up', 'down', 'unchanged']),
    ratingChange: signedInt32,
    observationCount: z.int().min(2).max(365).meta({ format: 'int32' }),
    fromObservedAt: utcDateTime,
    toObservedAt: utcDateTime,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedDirection = value.ratingChange > 0 ? 'up' : value.ratingChange < 0 ? 'down' : 'unchanged'
    if (value.direction !== expectedDirection) {
      context.addIssue({ code: 'custom', message: 'direction must match ratingChange', path: ['direction'] })
    }
    if (Date.parse(value.fromObservedAt) > Date.parse(value.toObservedAt)) {
      context.addIssue({ code: 'custom', message: 'observation coverage must be chronological' })
    }
  })

const sparsePulseSchema = z
  .object({
    checkedAt: utcDateTime,
    lastSuccessAt: utcDateTime.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lastSuccessAt && Date.parse(value.lastSuccessAt) > Date.parse(value.checkedAt)) {
      context.addIssue({ code: 'custom', message: 'pulse success cannot be later than its latest check' })
    }
  })

export const playerRankedSnapshotSchema = z
  .object({
    oneVsOne: oneVsOneSchema,
    rankedLegends: z.array(rankedLegendSchema),
    mainLegend: mainLegendSchema.nullable(),
    fixedTeams: z.array(fixedTeamSchema),
    soloQueue: z.array(soloQueueSchema),
    ratingHistory: z.array(ratingHistorySchema).max(365),
    observedRatingDirection: observedRatingDirectionSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const direction = snapshot.observedRatingDirection
    if (!direction) return
    const observationTimes = new Set(snapshot.ratingHistory.map((point) => point.recordedAt))
    if (
      direction.observationCount > snapshot.ratingHistory.length ||
      !observationTimes.has(direction.fromObservedAt) ||
      !observationTimes.has(direction.toObservedAt)
    ) {
      context.addIssue({ code: 'custom', message: 'direction coverage must come from published rating history' })
    }
  })
  .meta({ id: 'PlayerRankedSnapshot' })

export const playerRankedProfileSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    checkedAt: utcDateTime,
    lastSuccessAt: utcDateTime.nullable(),
    freshness: z.enum(['fresh', 'stale', 'unavailable']),
    freshForSeconds: z.int().min(3_600).max(3_600).meta({ format: 'int32' }),
    sparsePulse: sparsePulseSchema.nullable(),
    snapshot: playerRankedSnapshotSchema.nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    const unavailable =
      profile.lastSuccessAt === null && profile.freshness === 'unavailable' && profile.snapshot === null
    const available = profile.lastSuccessAt !== null && profile.freshness !== 'unavailable' && profile.snapshot !== null
    if (!unavailable && !available) {
      context.addIssue({ code: 'custom', message: 'ranked availability fields are inconsistent' })
    }
    if (profile.sparsePulse && !available) {
      context.addIssue({ code: 'custom', message: 'sparse pulse evidence requires canonical ranked state' })
    }
  })
  .meta({ id: 'PlayerRankedProfile' })

export const nullablePlayerRankedProfileSchema = playerRankedProfileSchema.nullable()
export type PlayerRankedProfileContract = z.infer<typeof playerRankedProfileSchema>

export function parsePlayerRankedProfileOutput(value: unknown): PlayerRankedProfileContract | null {
  return nullablePlayerRankedProfileSchema.parse(value)
}
