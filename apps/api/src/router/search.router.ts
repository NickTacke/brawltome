import { z } from 'zod'
import { searchLocal } from '../services/search.service'
import { publicProcedure, router } from '../trpc/trpc'

export const searchRouter = router({
  local: publicProcedure.input(z.object({ query: z.string().min(2).max(100) })).query(async ({ ctx, input }) => {
    return searchLocal(ctx, input.query)
  }),
})
