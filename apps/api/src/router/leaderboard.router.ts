import {
  leaderboardInputSchema,
  leaderboardRecentActivityInputSchema,
  parseLeaderboardRecentActivityOutput,
} from '@brawltome/contracts'
import { enrichLeaderboardEntries, readNamedLeaderboard } from '@brawltome/ranking'
import { publicProcedure, router } from '../trpc/trpc'

export const leaderboardRouter = router({
  get: publicProcedure
    .input(leaderboardInputSchema)
    .query(({ ctx, input }) => readNamedLeaderboard(ctx.rankingQueries, ctx.playerReferenceQueries, input)),
  recentActivity: publicProcedure.input(leaderboardRecentActivityInputSchema).query(async ({ ctx, input }) => {
    const output = parseLeaderboardRecentActivityOutput(
      await ctx.rankingQueries.getRecentActivity({
        mode: input.mode,
        region: input.region,
        page: input.page,
        pageSize: input.pageSize,
        snapshotId: input.snapshotId,
      }),
    )

    if (output.status === 'unavailable') return output

    return parseLeaderboardRecentActivityOutput({
      ...output,
      entries: await enrichLeaderboardEntries(output.entries, ctx.playerReferenceQueries),
    })
  }),
})
