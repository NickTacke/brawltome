import { DEDUP_TTL_CLAN_SEC, discoverClan, getClan } from '@brawltome/clan'
import { CLAN_TTL_MS, checkRateLimit, dedupKey, tryDedup, verifyTurnstile } from '@brawltome/shared'
import { z } from 'zod'
import { internalProcedure, router } from '../trpc/trpc'

export const clanRouter = router({
  byId: internalProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getClan(ctx.clanRepo, input.id)
  }),
  refresh: internalProcedure
    .input(z.object({ id: z.number().int().positive(), turnstileToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: clanId, turnstileToken } = input

      const turnstileValid = await verifyTurnstile(turnstileToken, ctx.clientIp)
      if (!turnstileValid) return { isRefreshing: false }

      const c = await ctx.clanRepo.findById(clanId)

      if (!c) {
        if (ctx.isBot) return { isRefreshing: false }
        return discoverClan({ redis: ctx.redis, clanQueue: ctx.clanQueue, clientIp: ctx.clientIp }, clanId)
      }

      if (ctx.isBot) return { isRefreshing: false }

      if (!process.env.DISABLE_VIEW_REFRESH) {
        const age = Date.now() - c.lastUpdated.getTime()
        if (age > CLAN_TTL_MS) {
          const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
          if (refreshLimit.allowed) {
            const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
            if (canDedup) await ctx.clanQueue.enqueue({ clanId })
            return { isRefreshing: true }
          }
        }
      }

      return { isRefreshing: false }
    }),
})
