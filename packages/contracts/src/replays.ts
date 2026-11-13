import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

// matches parsed from uploaded replays, in the shape /v1 serves them; key holders of the public api will get the same

const dateTimeSchema = z.iso.datetime({ offset: false })

export const matchIdSchema = z.uuid()

export const replayUploadRejectionSchema = z.enum([
  'too-large',
  'not-a-replay',
  'too-many-pending',
  'daily-limit',
  'not-your-match',
  'game-error',
  'unreadable',
  'never-ended',
  'patch-not-supported',
  'unknown-format',
  'worker-error',
])

const matchPlayerSummarySchema = z
  .object({
    slot: z.number().int().min(1),
    brawlhallaId: brawlhallaIdSchema,
    name: z.string(),
    team: z.number().int(),
    legendId: z.number().int(),
    legendName: z.string(),
  })
  .strict()

export const matchSummarySchema = z
  .object({
    id: matchIdSchema,
    patch: z.string(),
    mapName: z.string(),
    modeName: z.string(),
    isRanked: z.boolean(),
    isCustom: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    parsedAt: dateTimeSchema,
    players: z.array(matchPlayerSummarySchema),
  })
  .strict()
  .meta({ id: 'MatchSummary' })

const matchPlayerSchema = matchPlayerSummarySchema
  .extend({
    damageDealt: z.number(),
    damageTaken: z.number(),
    kos: z.number().int(),
    deaths: z.number().int(),
    suicides: z.number().int(),
    teamKos: z.number().int(),
    clashes: z.number().int(),
    dodges: z.number().int(),
    airDodges: z.number().int(),
    jumps: z.number().int(),
    airJumps: z.number().int(),
    dashes: z.number().int(),
    dashJumps: z.number().int(),
    timeInAirMs: z.number().int(),
    timeOnGroundMs: z.number().int(),
    timeOnWallMs: z.number().int(),
    score: z.number().int(),
    weapons: z.record(z.string(), z.record(z.string(), z.number())),
  })
  .strict()

export const matchDetailSchema = matchSummarySchema
  .extend({
    queue: z.string().nullable(),
    hasTeams: z.boolean(),
    hasTeamDamage: z.boolean(),
    stocks: z.number().int().nullable(),
    isReliable: z.boolean(),
    failedChecks: z.array(z.string()),
    players: z.array(matchPlayerSchema),
    replay: z.object({ available: z.boolean(), patch: z.string(), fileName: z.string() }).strict(),
  })
  .strict()
  .meta({ id: 'MatchDetail' })

export const playerMatchesSchema = z
  .object({ matches: z.array(matchSummarySchema), nextCursor: z.string().nullable() })
  .strict()
  .meta({ id: 'PlayerMatches' })

export const playerMatchesInputSchema = z.object({
  brawlhallaId: z.coerce.number().pipe(brawlhallaIdSchema),
  cursor: z.string().max(200).optional(),
})

export const myReplaySchema = z
  .object({
    uploadId: z.uuid(),
    fileName: z.string().nullable(),
    status: z.enum(['waiting', 'parsing', 'done', 'rejected']),
    rejection: replayUploadRejectionSchema.nullable(),
    matchId: matchIdSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'MyReplay' })

export const myReplaysSchema = z.object({ replays: z.array(myReplaySchema) }).strict()

export const replayUploadOutcomeSchema = z
  .object({
    uploadId: z.uuid().nullable(),
    fileName: z.string(),
    status: z.enum(['queued', 'done', 'rejected']),
    matchId: matchIdSchema.nullable(),
    rejection: replayUploadRejectionSchema.nullable(),
  })
  .strict()

export const replayUploadResultSchema = z
  .object({ outcomes: z.array(replayUploadOutcomeSchema) })
  .strict()
  .meta({ id: 'ReplayUploadResult' })

// one request carries at most this many files; the site sends a dropped batch in chunks of it
export const MAX_REPLAYS_PER_UPLOAD = 20

export const replayUploadInputSchema = z.object({ files: z.array(z.file()).min(1).max(MAX_REPLAYS_PER_UPLOAD) })

export type MatchSummaryContract = z.infer<typeof matchSummarySchema>
export type MatchDetailContract = z.infer<typeof matchDetailSchema>
export type PlayerMatchesContract = z.infer<typeof playerMatchesSchema>
export type MyReplayContract = z.infer<typeof myReplaySchema>
export type ReplayUploadResultContract = z.infer<typeof replayUploadResultSchema>
