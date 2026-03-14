import {
  blacklist,
  player,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import { desc, eq, sql } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import {
  DEDUP_TTL_RANKED_SEC,
  DEDUP_TTL_STATS_SEC,
  DISCOVERY_MIN_TOKENS,
  QUEUE_DISCOVERY_CAP,
  TIERED_TTL,
} from './constants'
import { getLegendById, normalizeWeaponName } from './game-data.service'

const discoveries = new Map<number, Promise<PlayerResult | null>>()

type PlayerResult = Awaited<ReturnType<typeof queryPlayer>> & {
  ratingHistory: (typeof ratingHistory.$inferSelect)[]
  isRefreshing: boolean
}

async function queryPlayer(ctx: Context, brawlhallaId: number) {
  return ctx.db.query.player.findFirst({
    where: eq(player.brawlhallaId, brawlhallaId),
    with: {
      aliases: true,
      statsLegends: true,
      weaponStats: true,
      clan: true,
      rankedLegends: true,
      rankedTeams: true,
    },
  })
}

export async function getPlayer(ctx: Context, brawlhallaId: number): Promise<PlayerResult | null> {
  const blocked = await ctx.db.query.blacklist.findFirst({
    where: eq(blacklist.brawlhallaId, brawlhallaId),
  })
  if (blocked) return null

  const p = await queryPlayer(ctx, brawlhallaId)

  if (!p) {
    return discoverPlayer(ctx, brawlhallaId)
  }

  // Update view count and refresh tier
  const now = new Date()
  await ctx.db
    .update(player)
    .set({
      viewCount: sql`${player.viewCount} + 1`,
      lastViewedAt: now,
      refreshTier: 'hot',
    })
    .where(eq(player.brawlhallaId, brawlhallaId))

  // Check staleness and queue refreshes
  const tier = p.refreshTier ?? 'cold'
  const ttl = TIERED_TTL[tier as keyof typeof TIERED_TTL] ?? TIERED_TTL.cold
  let isRefreshing = false

  if (p.rankedLastUpdated) {
    const rankedAge = now.getTime() - p.rankedLastUpdated.getTime()
    if (rankedAge > ttl.ranked) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
      if (canDedup) {
        await ctx.rankedQueue.enqueue({ brawlhallaId })
        isRefreshing = true
      }
    }
  }

  if (p.statsLastUpdated) {
    const statsAge = now.getTime() - p.statsLastUpdated.getTime()
    if (statsAge > ttl.stats) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC)
      if (canDedup) {
        await ctx.statsQueue.enqueue({ brawlhallaId })
        isRefreshing = true
      }
    }
  }

  const history = await ctx.db.query.ratingHistory.findMany({
    where: eq(ratingHistory.brawlhallaId, brawlhallaId),
    orderBy: [desc(ratingHistory.recordedAt)],
    limit: 365,
  })

  // Enrich stats legends with weapon names from game data cache
  const enrichedStatsLegends = (p.statsLegends || []).map((l: typeof p.statsLegends[number]) => {
    const legendData = getLegendById(l.legendId)
    return {
      ...l,
      weaponOne: legendData ? normalizeWeaponName(legendData.weaponOne) : null,
      weaponTwo: legendData ? normalizeWeaponName(legendData.weaponTwo) : null,
      bioName: legendData?.bioName ?? null,
    }
  })

  return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history, isRefreshing }
}

async function discoverPlayer(ctx: Context, brawlhallaId: number): Promise<PlayerResult | null> {
  const existing = discoveries.get(brawlhallaId)
  if (existing) return existing

  const queueDepth = (await ctx.rankedQueue.depth()) + (await ctx.statsQueue.depth())
  if (queueDepth > QUEUE_DISCOVERY_CAP) return null
  if (ctx.bhapi.remainingTokens < DISCOVERY_MIN_TOKENS) return null

  const promise = (async () => {
    try {
      const stats = await ctx.bhapi.getPlayerStats(brawlhallaId)
      if (!stats?.name) return null

      const ranked = await ctx.bhapi.getPlayerRanked(brawlhallaId)

      await ctx.db
        .insert(player)
        .values({
          brawlhallaId,
          name: stats.name,
          region: ranked?.region ?? null,
          rating: ranked?.rating ?? 0,
          peakRating: ranked?.peak_rating ?? 0,
          tier: ranked?.tier ?? null,
          rankedGames: ranked?.games ?? 0,
          rankedWins: ranked?.wins ?? 0,
          refreshTier: 'hot',
        })
        .onConflictDoNothing()

      await ctx.rankedQueue.enqueue({ brawlhallaId })
      await ctx.statsQueue.enqueue({ brawlhallaId })

      return getPlayer(ctx, brawlhallaId)
    } finally {
      discoveries.delete(brawlhallaId)
    }
  })()

  discoveries.set(brawlhallaId, promise)
  setTimeout(() => discoveries.delete(brawlhallaId), 30_000)

  return promise
}
