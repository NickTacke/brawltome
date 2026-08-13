import { nullablePlayerReferenceSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { mapPlayerReference } from '../mappers/player-reference.mapper'
import { internalProcedure, router } from '../trpc/trpc'

export function createPlayerReferenceRouter(procedure = internalProcedure) {
  return router({
    referenceById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerReferenceSchema)
      .query(async ({ ctx, input }) => mapPlayerReference(await ctx.playerReferenceQueries.byId(input.id))),
  })
}
