import { publicProcedure, router } from '../trpc/trpc'

export const statusRouter = router({
  health: publicProcedure.query(() => {
    return { status: 'healthy' as const }
  }),
})
