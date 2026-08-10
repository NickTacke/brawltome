import { nullablePlayerRankedProfileSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { mapPlayerRankedProfile } from '../mappers/player-ranked.mapper'
import { internalProcedure, router } from '../trpc/trpc'

export function createPlayerRankedRouter(procedure = internalProcedure) {
  return router({
    rankedById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerRankedProfileSchema)
      .query(async ({ ctx, input }) => mapPlayerRankedProfile(await ctx.rankedPlayerQueries.byId(input.id))),
  })
}
