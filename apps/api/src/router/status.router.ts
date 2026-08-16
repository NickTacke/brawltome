import { discordBotProcedure, router } from '../trpc/trpc'

export const statusRouter = router({
  discordReady: discordBotProcedure.query(() => ({ status: 'ready' as const })),
})
