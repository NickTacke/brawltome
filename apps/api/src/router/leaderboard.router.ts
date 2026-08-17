import {
  type LeaderboardIdentity,
  leaderboardInputSchema,
  leaderboardRecentActivityInputSchema,
  parseLeaderboardOutput,
  parseLeaderboardRecentActivityOutput,
} from '@brawltome/contracts'
import type { Context } from '../trpc/context'
import { publicProcedure, router } from '../trpc/trpc'

type Contestant = LeaderboardIdentity extends infer Identity
  ? Identity extends { player: infer Player }
    ? Player
    : Identity extends { players: readonly (infer Player)[] }
      ? Player
      : never
  : never

type EnrichableEntry = { identity: LeaderboardIdentity }

async function enrichLeaderboardEntries(
  entries: readonly EnrichableEntry[],
  references: Context['playerReferenceQueries'],
): Promise<EnrichableEntry[]> {
  const contestants = entries.flatMap((entry) =>
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
  return entries.map((entry) => {
    const identity = entry.identity
    if (identity.type !== 'fixed-two-vs-two-team') {
      return { ...entry, identity: { ...identity, player: enrich(identity.player) } }
    }
    const sameAccount = identity.players[0].brawlhallaId === identity.players[1].brawlhallaId
    return {
      ...entry,
      identity: {
        ...identity,
        players: [
          {
            ...enrich(identity.players[0]),
            ...(sameAccount ? { name: identity.players[0].name } : {}),
          },
          {
            ...enrich(identity.players[1]),
            ...(sameAccount ? { name: identity.players[1].name } : {}),
          },
        ],
      },
    }
  })
}

export const leaderboardRouter = router({
  get: publicProcedure.input(leaderboardInputSchema).query(async ({ ctx, input }) => {
    const output = parseLeaderboardOutput(
      await ctx.rankingQueries.getLeaderboard({
        mode: input.mode,
        region: input.region,
        page: input.page,
        pageSize: input.pageSize,
        snapshotId: input.snapshotId,
      }),
    )
    if (output.status === 'unavailable') return output
    return parseLeaderboardOutput({
      ...output,
      entries: await enrichLeaderboardEntries(output.entries, ctx.playerReferenceQueries),
    })
  }),
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
