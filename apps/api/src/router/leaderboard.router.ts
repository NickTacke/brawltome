import { z } from 'zod'
import { getLeaderboard } from '../services/leaderboard.service'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure
    .input(
      z.object({
        bracket: z.enum(['1v1', '2v2']),
        region: z.enum(['us-e', 'eu', 'sea', 'brz', 'aus', 'us-w', 'jpn', 'me', 'sa', 'all']),
        page: z.number().int().min(1).max(200),
        pageSize: z.number().int().min(1).max(100).optional(),
        sort: z.enum(['rating', 'peakRating', 'wins', 'games']).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getLeaderboard(ctx, input)
    }),
})
