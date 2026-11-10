import { z } from './zod'

const metaLegendSchema = z
  .object({
    legendNameKey: z.string().min(1),
    games: z.int().positive(),
    // the high rated players who play the legend
    playerCount: z.int().positive(),
    winRate: z.number().min(0).max(1),
  })
  .strict()

// null until a season start has been seen in the rating history
export const metaLegendsSchema = z
  .object({
    season: z.int().positive(),
    startsAt: z.iso.datetime(),
    legends: z.array(metaLegendSchema),
  })
  .strict()
  .nullable()

export type MetaLegendsContract = z.infer<typeof metaLegendsSchema>
