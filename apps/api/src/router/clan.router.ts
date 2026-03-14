import { z } from 'zod'
import { getClan } from '../services/clan.service'
import { publicProcedure, router } from '../trpc/trpc'

export const clanRouter = router({
  byId: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    return getClan(ctx, input.id)
  }),
})
