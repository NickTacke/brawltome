import { z } from 'zod'
import { getClan } from '../services/clan.service'
import { internalProcedure, router } from '../trpc/trpc'

export const clanRouter = router({
  byId: internalProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getClan(ctx, input.id)
  }),
})
