import { searchLocal } from '@brawltome/ranking'
import { z } from 'zod'
import { publicProcedure, router } from '../trpc/trpc'

export const searchRouter = router({
  local: publicProcedure.input(z.object({ query: z.string().min(2).max(100) })).query(async ({ ctx, input }) => {
    return searchLocal(ctx.rankingRepo, input.query)
  }),
})
