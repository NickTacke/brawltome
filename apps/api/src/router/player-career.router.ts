import { nullablePlayerCareerProfileSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import { mapPlayerCareerProfile } from '../mappers/player-career.mapper'
import { internalProcedure, router } from '../trpc/trpc'

export function createPlayerCareerRouter(procedure = internalProcedure) {
  return router({
    careerById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerCareerProfileSchema)
      .query(async ({ ctx, input }) => mapPlayerCareerProfile(await ctx.careerPlayerQueries.byId(input.id))),
  })
}
