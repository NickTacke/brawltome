import { clan, player } from '@brawltome/database'
import { eq, inArray } from 'drizzle-orm'
import { dedupKey, tryDedup } from '../queue/dedup'
import type { Context } from '../trpc/context'
import { CLAN_TTL_MS, DEDUP_TTL_CLAN_SEC } from './constants'
import { checkRateLimit } from './rate-limit.service'
import { verifyTurnstile } from './turnstile.service'

export async function getClan(ctx: Context, clanId: number) {
  const c = await ctx.db.query.clan.findFirst({
    where: eq(clan.clanId, clanId),
    with: { members: true },
  })

  if (!c) return null

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

  return { ...c, members }
}

export async function refreshClan(
  ctx: Context,
  clanId: number,
  turnstileToken: string,
): Promise<{ isRefreshing: boolean }> {
  const turnstileValid = await verifyTurnstile(turnstileToken, ctx.clientIp)
  if (!turnstileValid) return { isRefreshing: false }

  const c = await ctx.db.query.clan.findFirst({
    where: eq(clan.clanId, clanId),
    with: { members: true },
  })

  if (!c) {
    // Discovery flow
    if (ctx.isBot) return { isRefreshing: false }

    const globalLimit = await checkRateLimit(ctx.redis, 'global', 'discovery:global')
    if (!globalLimit.allowed) return { isRefreshing: false }

    const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
    if (!discoveryLimit.allowed) return { isRefreshing: false }

    const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
    if (!canDedup) return { isRefreshing: false }

    console.log(`[discover] enqueuing clan ${clanId} via priority queue`)
    await ctx.clanQueue.enqueue({ clanId }, true)

    return { isRefreshing: true }
  }

  // Refresh flow for existing clan
  if (ctx.isBot) return { isRefreshing: false }

  if (!process.env.DISABLE_VIEW_REFRESH) {
    const age = Date.now() - c.lastUpdated.getTime()
    if (age > CLAN_TTL_MS) {
      const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
      if (canDedup) {
        const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
        if (refreshLimit.allowed) {
          await ctx.clanQueue.enqueue({ clanId })
          return { isRefreshing: true }
        }
      } else {
        return { isRefreshing: true } // Already queued by another request
      }
    }
  }

  return { isRefreshing: false }
}
