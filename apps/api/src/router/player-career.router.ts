import {
  type PlayerCareerProfileContract,
  nullablePlayerCareerProfileSchema,
  parsePlayerCareerProfileOutput,
  playerReferenceByIdInputSchema,
} from '@brawltome/contracts'
import type { CareerPlayerProfile } from '@brawltome/player'
import { internalProcedure, router } from '../trpc/trpc'

function mapPlayerCareerProfile(profile: CareerPlayerProfile | null): PlayerCareerProfileContract | null {
  if (!profile) return null
  return parsePlayerCareerProfileOutput({
    ...profile,
    checkedAt: profile.checkedAt.toISOString(),
    lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null,
  })
}

export function createPlayerCareerRouter(procedure = internalProcedure) {
  return router({
    careerById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerCareerProfileSchema)
      .query(async ({ ctx, input }) => mapPlayerCareerProfile(await ctx.careerPlayerQueries.byId(input.id))),
  })
}
