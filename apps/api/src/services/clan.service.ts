import { clan, player } from '@brawltome/database'
import { eq, inArray } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import { CLAN_TTL_MS, DEDUP_TTL_CLAN_SEC } from './constants'
import { checkRateLimit } from './rate-limit.service'

export async function getClan(ctx: Context, clanId: number) {
  const c = await ctx.db.query.clan.findFirst({
    where: eq(clan.clanId, clanId),
    with: { members: true },
  })

  if (!c) {
    if (ctx.isBot) return null
    return discoverClan(ctx, clanId)
  }

  let isRefreshing = false
  if (!ctx.isBot && !process.env.DISABLE_VIEW_REFRESH) {
    const age = Date.now() - c.lastUpdated.getTime()
    if (age > CLAN_TTL_MS) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
      if (canDedup) {
        const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
        if (refreshLimit.allowed) {
          await ctx.clanQueue.enqueue({ clanId })
          isRefreshing = true
        }
      }
    }
  }

  // Enrich members with player ratings
  const memberIds = c.members.map((m) => m.brawlhallaId)
  let playerMap = new Map<number, { rating: number; peakRating: number | null }>()

  if (memberIds.length > 0) {
    const players = await ctx.db
      .select({
        brawlhallaId: player.brawlhallaId,
        rating: player.rating,
        peakRating: player.peakRating,
      })
      .from(player)
      .where(inArray(player.brawlhallaId, memberIds))

    playerMap = new Map(players.map((p) => [p.brawlhallaId, { rating: p.rating, peakRating: p.peakRating }]))
  }

  const members = c.members.map((m) => ({
    ...m,
    rating: playerMap.get(m.brawlhallaId)?.rating ?? 0,
    peakRating: playerMap.get(m.brawlhallaId)?.peakRating ?? 0,
  }))

  return { ...c, members, isRefreshing }
}

async function discoverClan(ctx: Context, clanId: number) {
  const globalLimit = await checkRateLimit(ctx.redis, 'global', 'discovery:global')
  if (!globalLimit.allowed) return null

  const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
  if (!discoveryLimit.allowed) return null

  const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
  if (!canDedup) return null

  console.log(`[discover] enqueuing clan ${clanId} via priority queue (ip=${ctx.clientIp})`)
  await ctx.clanQueue.enqueue({ clanId }, true)

  return {
    clanId,
    clanName: `Clan ${clanId}`,
    clanCreateDate: new Date(),
    clanXp: 0n,
    clanLifetimeXp: 0n,
    lastUpdated: new Date(),
    members: [],
    isRefreshing: true,
  }
}
