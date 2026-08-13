import { discoverySearchInputSchema, discoverySearchOutputSchema } from '@brawltome/contracts'
import { publicProcedure, router } from '../trpc/trpc'

export function createSearchRouter(procedure = publicProcedure) {
  return router({
    local: procedure
      .input(discoverySearchInputSchema)
      .output(discoverySearchOutputSchema)
      .query(({ ctx, input }) => ctx.discoveryQueries.search(input.query)),
  })
}

export const searchRouter = createSearchRouter()
