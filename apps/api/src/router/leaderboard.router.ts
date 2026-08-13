import { type LeaderboardOutput, leaderboardInputSchema, parseLeaderboardOutput } from '@brawltome/contracts'
import { mapLeaderboardOutput } from '../mappers/leaderboard.mapper'
import type { Context } from '../trpc/context'
import { publicProcedure, router } from '../trpc/trpc'

type AvailableLeaderboard = Extract<LeaderboardOutput, { status: 'fresh' | 'stale' }>
type Contestant = AvailableLeaderboard['entries'][number]['identity'] extends infer Identity
  ? Identity extends { player: infer Player }
    ? Player
    : Identity extends { players: readonly (infer Player)[] }
      ? Player
      : never
  : never

async function enrichBestLegends(
  output: LeaderboardOutput,
  references: Context['playerReferenceQueries'],
): Promise<LeaderboardOutput> {
  if (output.status === 'unavailable') return output
  const contestants = output.entries.flatMap((entry) =>
    entry.identity.type === 'fixed-two-vs-two-team' ? [...entry.identity.players] : [entry.identity.player],
  )
  const referenceById = new Map(
    await Promise.all(
      [...new Set(contestants.map(({ brawlhallaId }) => brawlhallaId))].map(
        async (brawlhallaId) => [brawlhallaId, await references.byId(brawlhallaId)] as const,
      ),
    ),
  )
  const enrich = (player: Contestant) => {
    const reference = referenceById.get(player.brawlhallaId)
    return {
      ...player,
      name: reference?.name ?? player.name,
      bestLegendNameKey: reference?.bestLegendNameKey ?? null,
    }
  }
  return parseLeaderboardOutput({
    ...output,
    entries: output.entries.map((entry) => ({
      ...entry,
      identity:
        entry.identity.type === 'fixed-two-vs-two-team'
          ? { ...entry.identity, players: entry.identity.players.map(enrich) }
          : { ...entry.identity, player: enrich(entry.identity.player) },
    })),
  })
}

export const leaderboardRouter = router({
  get: publicProcedure.input(leaderboardInputSchema).query(async ({ ctx, input }) => {
    const output = mapLeaderboardOutput(
      await ctx.rankingQueries.getLeaderboard({
        mode: input.mode,
        region: input.region,
        page: input.page,
        pageSize: input.pageSize,
        snapshotId: input.snapshotId,
      }),
    )
    return enrichBestLegends(output, ctx.playerReferenceQueries)
  }),
})
