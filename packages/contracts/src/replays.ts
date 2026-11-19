import { matchInsightsSchema } from './match-insights'
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
    // the legend as the game data names it, and the key the site finds its portrait by
    legendName: z.string(),
    legendKey: z.string(),
    kos: z.number().int(),
    deaths: z.number().int(),
    damageDealt: z.number(),
    // null for a stock match, which the game doesn't score
    score: z.number().int().nullable(),
    // the side that fell least wins a stock match, the side that scored most a timed one; a tie has two winners
    isWinner: z.boolean(),
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
    queue: z.string().nullable(),
    hasTeams: z.boolean(),
    stocks: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    parsedAt: dateTimeSchema,
    // the level's background from the match art, once the replay worker has drawn its map
    mapPictureUrl: z.string().url().nullable(),
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
    weapons: z.record(z.string(), z.record(z.string(), z.number())),
  })
  .strict()

// the art the replay worker exported for a match, drawn from the public art bucket. a queued or failed export keeps
// the last good manifest, so its address is there whatever the state; both addresses are null without a bucket
const matchArtSchema = z
  .object({
    state: z.enum(['none', 'queued', 'ready', 'failed']),
    manifestUrl: z.string().url().nullable(),
    baseUrl: z.string().url().nullable(),
  })
  .strict()

export const matchDetailSchema = matchSummarySchema
  .extend({
    hasTeamDamage: z.boolean(),
    isReliable: z.boolean(),
    failedChecks: z.array(z.string()),
    players: z.array(matchPlayerSchema),
    replay: z.object({ available: z.boolean(), patch: z.string(), fileName: z.string() }).strict(),
    // null for a match the page isn't designed for: anything but a stock 1v1 or 2v2 with a timeline
    insights: matchInsightsSchema.nullable(),
    art: matchArtSchema,
    // where the site serves the match's trimmed timeline for playback; null whenever insights are
    playbackPath: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'MatchDetail' })

export const playerMatchesSchema = z
  .object({ matches: z.array(matchSummarySchema), nextCursor: z.string().nullable() })
  .strict()
  .meta({ id: 'PlayerMatches' })

export const recentMatchesSchema = z
  .object({ matches: z.array(matchSummarySchema), nextCursor: z.string().nullable() })
  .strict()
  .meta({ id: 'RecentMatches' })

export const matchPageInputSchema = z.object({ cursor: z.string().max(200).optional() })

// how a player has done in their uploaded matches, all of them, not just the page shown
const matchRecordSchema = z
  .object({
    games: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    lastParsedAt: dateTimeSchema.nullable(),
    legends: z.array(
      z
        .object({
          legendId: z.number().int(),
          legendName: z.string(),
          legendKey: z.string(),
          games: z.number().int().positive(),
          wins: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()

// the visitor's verified player and every uploaded match they played in, whoever uploaded it
export const myMatchesSchema = z
  .object({
    player: z.object({ brawlhallaId: brawlhallaIdSchema, name: z.string().nullable() }).strict().nullable(),
    // only on the first page: it covers every match, not just the page
    record: matchRecordSchema.nullable(),
    matches: z.array(matchSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'MyMatches' })

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

// whether the visitor may see replays and match pages (everyone once they're open, operators before that), and
// whether they may upload: a player verified with Steam, or an operator
export const replayAccessSchema = z
  .object({ isOpen: z.boolean(), canSee: z.boolean(), canUpload: z.boolean() })
  .strict()
  .meta({ id: 'ReplayAccess' })

export type ReplayAccessContract = z.infer<typeof replayAccessSchema>
export type MatchSummaryContract = z.infer<typeof matchSummarySchema>
export type MatchDetailContract = z.infer<typeof matchDetailSchema>
export type PlayerMatchesContract = z.infer<typeof playerMatchesSchema>
export type RecentMatchesContract = z.infer<typeof recentMatchesSchema>
export type MyMatchesContract = z.infer<typeof myMatchesSchema>
export type MyReplayContract = z.infer<typeof myReplaySchema>
export type ReplayUploadResultContract = z.infer<typeof replayUploadResultSchema>
