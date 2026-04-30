import { getLeaderboard } from '@brawltome/ranking'
import { z } from 'zod'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure
    .input(
      z
        .object({
          bracket: z.enum(['1v1', '2v2', 'solo2v2', '3v3']),
          region: z.enum(['US-E', 'EU', 'SEA', 'BRZ', 'AUS', 'US-W', 'JPN', 'ME', 'SA', 'all']),
          page: z.number().int().min(1).max(500),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .passthrough(), // accept legacy ?sort=...&order=... silently
    )
    .query(async ({ ctx, input }) => {
      return getLeaderboard({ playerRepo: ctx.playerRepo }, input)
    }),
})
