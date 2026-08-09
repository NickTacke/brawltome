import { leaderboard1v1InputSchema } from '@brawltome/contracts'
import { getLeaderboard } from '@brawltome/ranking'
import { z } from 'zod'
import { mapLeaderboard1v1Output } from '../mappers/leaderboard.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  oneVsOne: publicProcedure.input(leaderboard1v1InputSchema).query(async ({ ctx, input }) => {
    return mapLeaderboard1v1Output(
      await ctx.rankingQueries.get1v1({
        region: input.region,
        page: input.page,
        pageSize: input.pageSize,
        snapshotId: input.snapshotId,
      }),
    )
  }),

  get: publicProcedure
    .input(
      z
        .object({
          bracket: z.enum(['1v1', '2v2', 'solo2v2', '3v3']),
          region: z.enum(['US-E', 'EU', 'SEA', 'BRZ', 'AUS', 'US-W', 'JPN', 'ME', 'SA', 'all']),
          page: z.number().int().min(1).max(500),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .passthrough(),
    )
    .query(async ({ ctx, input }) => getLeaderboard({ playerRepo: ctx.playerRepo }, input)),
})
