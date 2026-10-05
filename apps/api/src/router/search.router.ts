import { discoverySearchInputSchema, discoverySearchOutputSchema } from '@brawltome/contracts'
import { publicProcedure, router } from '../trpc/trpc'

export function createSearchRouter(procedure = publicProcedure) {
  return router({
    local: procedure
      .input(discoverySearchInputSchema)
      .output(discoverySearchOutputSchema)
      .query(async ({ ctx, input }) => {
        const result = await ctx.discoveryQueries.search(input.query)
        try {
          ctx.telemetry.metrics.add('search_requests_total', 1, {
            outcome: result.players.length + result.clans.length > 0 ? 'hit' : 'miss',
          })
        } catch {
          // telemetry must never fail a search
        }
        return result
      }),
  })
}

export const searchRouter = createSearchRouter()
