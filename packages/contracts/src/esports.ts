import { z } from './zod'

const countSchema = z.int().nonnegative()
const esportsModeSchema = z.enum(['1v1', '2v2'])

const powerRankingSchema = z
  .object({
    mode: esportsModeSchema,
    rank: z.int().positive(),
    region: z.string(),
    gold: countSchema,
    silver: countSchema,
    bronze: countSchema,
    top8: countSchema,
  })
  .strict()

// brawltools leaves the id out for opponents it can't tie to a brawlhalla account
const esportsOpponentSchema = z.object({ brawlhallaId: z.int().nullable(), name: z.string() }).strict()

const esportsSetSchema = z
  .object({
    id: z.string().min(1),
    isWin: z.boolean(),
    // won or lost without playing, its score is "DQ"
    isForfeit: z.boolean(),
    score: z.string().min(1),
    opponents: z.array(esportsOpponentSchema),
    // null when the legend is unknown or the site has no art for it
    legendKey: z.string().min(1).nullable(),
    opponentLegendKey: z.string().min(1).nullable(),
  })
  .strict()

const setRecordSchema = z.object({ wins: countSchema, losses: countSchema }).strict()

const esportsResultSchema = z
  .object({
    id: z.string().min(1),
    tournamentId: z.string().min(1),
    mode: esportsModeSchema,
    placement: z.int().positive(),
    fullName: z.string(),
    heading: z.string(),
    title: z.string(),
    meta: z.string(),
    // unix seconds
    startTime: z.int(),
    isOfficial: z.boolean(),
    isOnline: z.boolean(),
    legendKey: z.string().min(1).nullable(),
    // how much the finish counts for the cards, higher first; 0 below top 8. optional so a site reading an api from
    // before it still parses during a deploy
    importance: z.number().nonnegative().optional(),
    // first round first
    sets: z.array(esportsSetSchema),
    // forfeits left out; null when no set was played
    setRecord: setRecordSchema.nullable(),
  })
  .strict()

const esportsProfileSchema = z
  .object({
    // null when the player has not earned anything
    earnings: z.number().positive().nullable(),
    rankings: z.array(powerRankingSchema),
    // newest first
    results: z.array(esportsResultSchema),
  })
  .strict()

/**
 * A player's esports results from Brawltools. The profile is null when Brawltools does not know the player, when its
 * record can't be trusted to be this account, or when there is no placement to show. Freshness says whether the
 * stored data is due a refresh: missing when it was never fetched.
 */
export const playerEsportsSchema = z
  .object({
    profile: esportsProfileSchema.nullable(),
    freshness: z.enum(['fresh', 'stale', 'missing']),
  })
  .strict()

export type PlayerEsportsContract = z.infer<typeof playerEsportsSchema>
