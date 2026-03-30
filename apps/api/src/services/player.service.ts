import { blacklist, player, ratingHistory } from '@brawltome/database'
import { desc, eq, sql } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import { DEDUP_TTL_RANKED_SEC, DEDUP_TTL_STATS_SEC, TIERED_TTL } from './constants'
import { getLegendById, normalizeWeaponName } from './game-data.service'
import { checkRateLimit } from './rate-limit.service'
import { verifyTurnstile } from './turnstile.service'

type QueryResult = NonNullable<Awaited<ReturnType<typeof queryPlayer>>>
type EnrichedStatsLegend = QueryResult['statsLegends'][number] & {
  weaponOne: string | null
  weaponTwo: string | null
  bioName: string | null
}
type PlayerResult = Omit<QueryResult, 'statsLegends'> & {
  statsLegends: EnrichedStatsLegend[]
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
  if (!p) return null

  const history = await ctx.db.query.ratingHistory.findMany({
    where: eq(ratingHistory.brawlhallaId, brawlhallaId),
    orderBy: [desc(ratingHistory.recordedAt)],
    limit: 365,
  })

  const enrichedStatsLegends = (p.statsLegends || []).map((l: (typeof p.statsLegends)[number]) => {
    const legendData = getLegendById(l.legendId)
    return {
      ...l,
      weaponOne: legendData ? normalizeWeaponName(legendData.weaponOne) : null,
      weaponTwo: legendData ? normalizeWeaponName(legendData.weaponTwo) : null,
      bioName: legendData?.bioName ?? null,
    }
  })

  return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history, isRefreshing: false }
}

export async function refreshPlayer(
  ctx: Context,
  brawlhallaId: number,
  turnstileToken: string,
): Promise<{ isRefreshing: boolean }> {
  const turnstileValid = await verifyTurnstile(turnstileToken, ctx.clientIp)
  if (!turnstileValid) return { isRefreshing: false }

  const blocked = await ctx.db.query.blacklist.findFirst({
    where: eq(blacklist.brawlhallaId, brawlhallaId),
  })
  if (blocked) return { isRefreshing: false }

  const p = await queryPlayer(ctx, brawlhallaId)

  if (!p) {
    // Discovery flow
    if (ctx.isBot) return { isRefreshing: false }

    const globalLimit = await checkRateLimit(ctx.redis, 'global', 'discovery:global')
    if (!globalLimit.allowed) return { isRefreshing: false }

    const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
    if (!discoveryLimit.allowed) return { isRefreshing: false }

    await ctx.db
      .insert(player)
      .values({
        brawlhallaId,
        name: `Player ${brawlhallaId}`,
        refreshTier: 'hot',
        lastUpdated: new Date(),
      })
      .onConflictDoNothing()

    console.log(`[discover] enqueuing ${brawlhallaId} via priority queue (ip=${ctx.clientIp})`)
    await ctx.rankedQueue.enqueue({ brawlhallaId }, true)
    await ctx.statsQueue.enqueue({ brawlhallaId }, true)

    return { isRefreshing: true }
  }

  // Refresh flow for existing player
  if (ctx.isBot) return { isRefreshing: false }

  const now = new Date()
  await ctx.db
    .update(player)
    .set({
      viewCount: sql`${player.viewCount} + 1`,
      lastViewedAt: now,
      refreshTier: 'hot',
    })
    .where(eq(player.brawlhallaId, brawlhallaId))

  let isRefreshing = false
  if (!process.env.DISABLE_VIEW_REFRESH) {
    const ttl = TIERED_TTL.hot

    const rankedStale = !p.rankedLastUpdated || now.getTime() - p.rankedLastUpdated.getTime() > ttl.ranked
    if (rankedStale) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
      if (canDedup) {
        const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
        if (refreshLimit.allowed) {
          await ctx.rankedQueue.enqueue({ brawlhallaId })
          isRefreshing = true
        }
      }
    }

    const statsStale = !p.statsLastUpdated || now.getTime() - p.statsLastUpdated.getTime() > ttl.stats
    if (statsStale) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC)
      if (canDedup) {
        const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
        if (refreshLimit.allowed) {
          await ctx.statsQueue.enqueue({ brawlhallaId })
          isRefreshing = true
        }
      }
    }
  }

  return { isRefreshing }
}
