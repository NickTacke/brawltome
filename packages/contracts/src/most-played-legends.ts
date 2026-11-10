import { z } from './zod'

const legendShareSchema = z
  .object({
    legendNameKey: z.string().min(1),
    games: z.int().positive(),
    // of every ranked game counted this season
    share: z.number().min(0).max(1),
  })
  .strict()

// null until a season start has been seen in the rating history
export const mostPlayedLegendsSchema = z
  .object({
    season: z.int().positive(),
    startsAt: z.iso.datetime(),
    playerCount: z.int().min(0),
    legends: z.array(legendShareSchema),
  })
  .strict()
  .nullable()

export type MostPlayedLegendsContract = z.infer<typeof mostPlayedLegendsSchema>
