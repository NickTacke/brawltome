import { leaderboardInputSchema, leaderboardRecentActivityInputSchema } from '@brawltome/contracts'
import { readNamedLeaderboard, readNamedRecentActivity } from '@brawltome/ranking'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure
    .input(leaderboardInputSchema)
    .query(({ ctx, input }) => readNamedLeaderboard(ctx.rankingQueries, ctx.playerReferenceQueries, input)),
  recentActivity: publicProcedure
    .input(leaderboardRecentActivityInputSchema)
    .query(({ ctx, input }) => readNamedRecentActivity(ctx.rankingQueries, ctx.playerReferenceQueries, input)),
})
