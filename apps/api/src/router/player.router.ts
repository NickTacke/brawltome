import { z } from 'zod'
import { getPlayer, refreshPlayer } from '../services/player.service'
import { internalProcedure, router } from '../trpc/trpc'

export const playerRouter = router({
  byId: internalProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getPlayer(ctx, input.id)
  }),
  refresh: internalProcedure
    .input(z.object({ id: z.number().int().positive(), turnstileToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return refreshPlayer(ctx, input.id, input.turnstileToken)
    }),
})
