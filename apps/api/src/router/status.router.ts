import { publicProcedure, router } from '../trpc/trpc'

export const statusRouter = router({
  health: publicProcedure.query(({ ctx }) => {
    const tokens = ctx.bhapi.remainingTokens
    let status: 'healthy' | 'degraded' | 'down' = 'healthy'

    if (tokens < 20) status = 'degraded'
    if (tokens === 0) status = 'down'

    return { status, tokens }
  }),
})
