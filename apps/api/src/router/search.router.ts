import { discoverySearchInputSchema, discoverySearchOutputSchema } from '@brawltome/contracts'
import { normalizeDiscoveryTerm } from '@brawltome/discovery'
import { publicProcedure, router } from '../trpc/trpc'

export function createSearchRouter(procedure = publicProcedure) {
  return router({
    local: procedure
      .input(discoverySearchInputSchema)
      .output(discoverySearchOutputSchema)
      .query(async ({ ctx, input }) => {
        const query = normalizeDiscoveryTerm(input.query)
        if ([...query].length < 2) return { players: [], clans: [] }
        const [players, clans] = await Promise.all([
          ctx.discoveryQueries.searchPlayers(query),
          ctx.clanRepo.searchClans(query),
        ])
        return { players, clans }
      }),
  })
}

export const searchRouter = createSearchRouter()
