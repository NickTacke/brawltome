import { clan, clanMember, player } from '@brawltome/database'
import { TRPCError } from '@trpc/server'
import { eq, inArray } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import { CLAN_TTL_MS, DEDUP_TTL_CLAN_SEC, DISCOVERY_MIN_TOKENS } from './constants'
import { checkRateLimit } from './rate-limit.service'
// biome-ignore lint/suspicious/noExplicitAny: circular type reference between getClan/discoverClan
const clanDiscoveries = new Map<number, Promise<any>>()

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
  const existing = clanDiscoveries.get(clanId)
  if (existing) return existing

  if (ctx.bhapi.remainingTokens < DISCOVERY_MIN_TOKENS) return null

  const promise = (async () => {
    try {
      const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
      if (!discoveryLimit.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Rate limited. Retry after ${discoveryLimit.retryAfter} seconds.`,
        })
      }

      const data = await ctx.bhapi.getClan(clanId)
      if (!data) return null

      const now = new Date()

      await ctx.db
        .insert(clan)
        .values({
          clanId: data.clan_id,
          clanName: data.clan_name,
          clanCreateDate: new Date(data.clan_create_date * 1000),
          clanXp: BigInt(data.clan_xp || '0'),
          clanLifetimeXp: BigInt(data.clan_lifetime_xp),
          lastUpdated: now,
        })
        .onConflictDoNothing()

      const members = data.clan.map((m) => ({
        clanId: data.clan_id,
        brawlhallaId: m.brawlhalla_id,
        name: m.name,
        rank: m.rank,
        joinDate: new Date(m.join_date * 1000),
        xp: m.xp,
      }))

      if (members.length > 0) {
        await ctx.db.insert(clanMember).values(members).onConflictDoNothing()
      }

      return {
        clanId: data.clan_id,
        clanName: data.clan_name,
        clanCreateDate: new Date(data.clan_create_date * 1000),
        clanXp: BigInt(data.clan_xp || '0'),
        clanLifetimeXp: BigInt(data.clan_lifetime_xp),
        lastUpdated: now,
        members: members.map((m) => ({ ...m, rating: 0, peakRating: 0 })),
        isRefreshing: false,
      }
    } finally {
      clanDiscoveries.delete(clanId)
    }
  })()

  clanDiscoveries.set(clanId, promise)
  return promise
}
