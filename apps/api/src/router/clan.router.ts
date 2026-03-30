import { z } from 'zod'
import { getClan, refreshClan } from '../services/clan.service'
import { internalProcedure, router } from '../trpc/trpc'

export const clanRouter = router({
  byId: internalProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getClan(ctx, input.id)
  }),
  refresh: internalProcedure
    .input(z.object({ id: z.number().int().positive(), turnstileToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return refreshClan(ctx, input.id, input.turnstileToken)
    }),
})
