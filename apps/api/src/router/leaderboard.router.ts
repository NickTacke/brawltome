import { getLeaderboard } from '@brawltome/ranking'
import { z } from 'zod'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure
    .input(
      z.object({
        bracket: z.enum(['1v1', '2v2', 'solo2v2']),
        region: z.enum(['US-E', 'EU', 'SEA', 'BRZ', 'AUS', 'US-W', 'JPN', 'ME', 'SA', 'all']),
        page: z.number().int().min(1).max(200),
        pageSize: z.number().int().min(1).max(100).optional(),
        sort: z.enum(['rating', 'peakRating', 'wins', 'games']).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLeaderboard({ rankingRepo: ctx.rankingRepo, playerRepo: ctx.playerRepo }, input)
    }),
})
