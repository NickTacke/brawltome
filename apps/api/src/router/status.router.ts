import { discordBotProcedure, router } from '../trpc/trpc'

export function createStatusRouter(procedure = discordBotProcedure) {
  return router({
    discordReady: procedure.query(() => ({ status: 'ready' as const })),
  })
}

export const statusRouter = createStatusRouter()
