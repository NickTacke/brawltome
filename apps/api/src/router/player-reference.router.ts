import { nullablePlayerReferenceSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { internalProcedure, router } from '../trpc/trpc'

export function createPlayerReferenceRouter(procedure = internalProcedure) {
  return router({
    referenceById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerReferenceSchema)
      .query(({ ctx, input }) => ctx.playerReferenceQueries.byId(input.id)),
  })
}
