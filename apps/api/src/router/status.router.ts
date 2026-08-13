import { discordBotProcedure, publicProcedure, router } from '../trpc/trpc'

export const statusRouter = router({
  health: publicProcedure.query(() => {
    return { status: 'healthy' as const }
  }),
  discordReady: discordBotProcedure.query(() => ({ status: 'ready' as const })),
})
