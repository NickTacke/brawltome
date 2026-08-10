import { leaderboardInputSchema } from '@brawltome/contracts'
import { mapLeaderboardOutput } from '../mappers/leaderboard.mapper'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure.input(leaderboardInputSchema).query(async ({ ctx, input }) => {
    return mapLeaderboardOutput(
      await ctx.rankingQueries.getLeaderboard({
        mode: input.mode,
        region: input.region,
        page: input.page,
        pageSize: input.pageSize,
        snapshotId: input.snapshotId,
      }),
    )
  }),
})
