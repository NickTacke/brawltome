import { z } from './zod'

export const leaderboardRegions = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export const leaderboardScopes = ['all', ...leaderboardRegions] as const

export const leaderboardRegionSchema = z.enum(leaderboardRegions)
export const leaderboardScopeSchema = z.enum(leaderboardScopes)

const utcDateTimeSchema = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })
const positiveInt32 = z.int().positive().max(2_147_483_647).meta({ format: 'int32' })
const nonnegativeInt32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })
const playerNameSchema = z
  .string()
  .refine((name) => [...name].length <= 256, 'Player name must contain at most 256 Unicode characters')
  .refine((name) => /[^\p{Separator}\p{Format}]/u.test(name), 'Player name must contain a visible character')

export const leaderboard1v1InputSchema = z
  .object({
    bracket: z.literal('1v1'),
    region: leaderboardScopeSchema,
    page: z.int().min(1).max(500),
    pageSize: z.int().min(1).max(100).optional(),
    snapshotId: z.uuid().optional(),
  })
  .strict()

export const leaderboard1v1EntrySchema = z
  .object({
    standing: positiveInt32,
    sourceRank: positiveInt32,
    brawlhallaId: positiveInt32,
    name: playerNameSchema,
    region: leaderboardRegionSchema,
    rating: nonnegativeInt32,
    peakRating: nonnegativeInt32.nullable(),
    wins: nonnegativeInt32,
    losses: nonnegativeInt32,
    games: nonnegativeInt32,
    tier: z.string().min(1).max(100).nullable(),
  })
  .strict()
  .refine(({ games, wins, losses }) => games === wins + losses, 'games must equal wins plus losses')

const provenanceSchema = z
  .object({
    source: z.literal('brawlhalla-v1-ranked-leaderboard'),
    contractVersion: z.literal(1),
    pageDepth: z.int().min(1).max(20),
  })
  .strict()

const availableFields = {
  snapshotId: z.uuid(),
  generationId: z.uuid(),
  region: leaderboardScopeSchema,
  observedAt: utcDateTimeSchema,
  publishedAt: utcDateTimeSchema,
  expectedNextPublicationAt: utcDateTimeSchema,
  provenance: provenanceSchema,
  page: z.int().min(1).max(500),
  pageSize: z.int().min(1).max(100),
  hasMore: z.boolean(),
  totalRows: nonnegativeInt32,
  entries: z.array(leaderboard1v1EntrySchema),
} as const

export const leaderboard1v1OutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fresh'), ...availableFields }).strict(),
  z.object({ status: z.literal('stale'), ...availableFields }).strict(),
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.enum(['not_yet_published', 'snapshot_not_found']),
      page: z.int().min(1).max(500),
      pageSize: z.int().min(1).max(100),
    })
    .strict(),
])

export type LeaderboardRegion = z.infer<typeof leaderboardRegionSchema>
export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>
export type Leaderboard1v1Input = z.infer<typeof leaderboard1v1InputSchema>
export type Leaderboard1v1Entry = z.infer<typeof leaderboard1v1EntrySchema>
export type Leaderboard1v1Output = z.infer<typeof leaderboard1v1OutputSchema>

export function parseLeaderboard1v1Output(value: unknown): Leaderboard1v1Output {
  return leaderboard1v1OutputSchema.parse(value)
}
