import { DEDUP_TTL_RANKED_SEC, DEDUP_TTL_STATS_SEC, discoverPlayer, getPlayer, isStale } from '@brawltome/player'
import { TIERED_TTL, checkRateLimit, dedupKey, tryDedup, verifyTurnstile } from '@brawltome/shared'
import { z } from 'zod'
import { internalProcedure, router } from '../trpc/trpc'

export const playerRouter = router({
  byId: internalProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getPlayer(ctx.playerRepo, input.id)
  }),
  refresh: internalProcedure
    .input(z.object({ id: z.number().int().positive(), turnstileToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id: brawlhallaId, turnstileToken } = input

      const turnstileValid = await verifyTurnstile(turnstileToken, ctx.clientIp)
      if (!turnstileValid) return { isRefreshing: false }

      const blocked = await ctx.playerRepo.isBlacklisted(brawlhallaId)
      if (blocked) return { isRefreshing: false }

      const p = await ctx.playerRepo.findById(brawlhallaId)

      if (!p) {
        if (ctx.isBot) return { isRefreshing: false }
        return discoverPlayer(
          {
            db: ctx.db,
            redis: ctx.redis,
            rankedQueue: ctx.rankedQueue,
            statsQueue: ctx.statsQueue,
            clientIp: ctx.clientIp,
          },
          brawlhallaId,
        )
      }

      if (ctx.isBot) return { isRefreshing: false }

      await ctx.playerRepo.incrementViewCount(brawlhallaId)

      let isRefreshing = false
      if (process.env.DISABLE_VIEW_REFRESH !== '1') {
        const ttl = TIERED_TTL.hot

        if (isStale(p.rankedLastUpdated, ttl.ranked)) {
          const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
          if (refreshLimit.allowed) {
            const canDedup = await tryDedup(ctx.redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
            if (canDedup) await ctx.rankedQueue.enqueue({ brawlhallaId, caller: 'on-demand' })
            isRefreshing = true
          }
        }

        if (isStale(p.statsLastUpdated, ttl.stats)) {
          const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
          if (refreshLimit.allowed) {
            const canDedup = await tryDedup(ctx.redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC)
            if (canDedup) await ctx.statsQueue.enqueue({ brawlhallaId, caller: 'on-demand' })
            isRefreshing = true
          }
        }
      }

      return { isRefreshing }
    }),
})
