import { z } from './zod'

export const leaderboardRegions = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export const leaderboardScopes = ['all', ...leaderboardRegions] as const
export const leaderboardModes = ['1v1', '2v2', 'solo2v2', '3v3'] as const

export const leaderboardRegionSchema = z.enum(leaderboardRegions)
export const leaderboardScopeSchema = z.enum(leaderboardScopes)
export const leaderboardModeSchema = z.enum(leaderboardModes)

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

const contestantSchema = z
  .object({
    brawlhallaId: positiveInt32,
    name: playerNameSchema,
  })
  .strict()

export const oneVsOneIdentitySchema = z
  .object({ type: z.literal('one-vs-one-player'), player: contestantSchema })
  .strict()
export const fixedTwoVsTwoIdentitySchema = z
  .object({
    type: z.literal('fixed-two-vs-two-team'),
    players: z.tuple([contestantSchema, contestantSchema]),
  })
  .strict()
  .refine(({ players }) => players[0].brawlhallaId < players[1].brawlhallaId, {
    message: 'fixed team player IDs must be distinct and ascending',
  })
export const soloTwoVsTwoIdentitySchema = z
  .object({ type: z.literal('solo-two-vs-two-player'), player: contestantSchema })
  .strict()
export const threeVsThreeIdentitySchema = z
  .object({ type: z.literal('three-vs-three-player'), player: contestantSchema })
  .strict()

export const leaderboardIdentitySchema = z.discriminatedUnion('type', [
  oneVsOneIdentitySchema,
  fixedTwoVsTwoIdentitySchema,
  soloTwoVsTwoIdentitySchema,
  threeVsThreeIdentitySchema,
])

export const leaderboardInputSchema = z
  .object({
    mode: leaderboardModeSchema,
    region: leaderboardScopeSchema,
    page: z.int().min(1).max(500),
    pageSize: z.int().min(1).max(100).optional(),
    snapshotId: z.uuid().optional(),
  })
  .strict()

const entryMetrics = {
  standing: positiveInt32,
  sourceRank: positiveInt32,
  region: leaderboardRegionSchema,
  rating: nonnegativeInt32,
  peakRating: nonnegativeInt32.nullable(),
  wins: nonnegativeInt32,
  losses: nonnegativeInt32,
  games: nonnegativeInt32,
  tier: z.string().min(1).max(100).nullable(),
} as const

function entrySchema<T extends z.ZodType>(identity: T) {
  return z
    .object({ ...entryMetrics, identity })
    .strict()
    .refine(({ games, wins, losses }) => games === wins + losses, 'games must equal wins plus losses')
}

export const leaderboard1v1EntrySchema = entrySchema(oneVsOneIdentitySchema)
export const leaderboardFixed2v2EntrySchema = entrySchema(fixedTwoVsTwoIdentitySchema)
export const leaderboardSolo2v2EntrySchema = entrySchema(soloTwoVsTwoIdentitySchema)
export const leaderboard3v3EntrySchema = entrySchema(threeVsThreeIdentitySchema)
export const leaderboardEntrySchema = z.union([
  leaderboard1v1EntrySchema,
  leaderboardFixed2v2EntrySchema,
  leaderboardSolo2v2EntrySchema,
  leaderboard3v3EntrySchema,
])

const provenanceSchema = z.union([
  z
    .object({
      source: z.literal('brawlhalla-v1-ranked-leaderboard'),
      contractVersion: z.literal(1),
      pageDepth: z.int().min(1).max(20),
    })
    .strict(),
  z
    .object({
      source: z.literal('v2-legacy'),
      contractVersion: z.literal(1),
      sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
      importedAt: utcDateTimeSchema,
      completeness: z.literal('frozen-repository-rows'),
    })
    .strict(),
])

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
} as const

function availableSchema<
  const Status extends 'fresh' | 'stale',
  const Mode extends (typeof leaderboardModes)[number],
  Entry extends z.ZodType,
>(status: Status, mode: Mode, entries: Entry) {
  return z
    .object({ status: z.literal(status), mode: z.literal(mode), ...availableFields, entries: z.array(entries) })
    .strict()
}

const availableOutputSchema = z.union([
  availableSchema('fresh', '1v1', leaderboard1v1EntrySchema),
  availableSchema('stale', '1v1', leaderboard1v1EntrySchema),
  availableSchema('fresh', '2v2', leaderboardFixed2v2EntrySchema),
  availableSchema('stale', '2v2', leaderboardFixed2v2EntrySchema),
  availableSchema('fresh', 'solo2v2', leaderboardSolo2v2EntrySchema),
  availableSchema('stale', 'solo2v2', leaderboardSolo2v2EntrySchema),
  availableSchema('fresh', '3v3', leaderboard3v3EntrySchema),
  availableSchema('stale', '3v3', leaderboard3v3EntrySchema),
])

const unavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: z.enum(['not_yet_published', 'snapshot_not_found']),
    mode: leaderboardModeSchema,
    page: z.int().min(1).max(500),
    pageSize: z.int().min(1).max(100),
  })
  .strict()

export const leaderboardOutputSchema = z.union([availableOutputSchema, unavailableSchema])

export type LeaderboardRegion = z.infer<typeof leaderboardRegionSchema>
export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>
export type LeaderboardMode = z.infer<typeof leaderboardModeSchema>
export type LeaderboardInput = z.infer<typeof leaderboardInputSchema>
export type LeaderboardIdentity = z.infer<typeof leaderboardIdentitySchema>
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>
export type LeaderboardOutput = z.infer<typeof leaderboardOutputSchema>

export function parseLeaderboardOutput(value: unknown): LeaderboardOutput {
  return leaderboardOutputSchema.parse(value)
}
