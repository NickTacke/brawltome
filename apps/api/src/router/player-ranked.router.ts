import { nullablePlayerRankedProfileSchema, playerReferenceByIdInputSchema } from '@brawltome/contracts'
import type { RankedPlayerProfile } from '@brawltome/player'
import type { PlayerValhallanEvidence } from '@brawltome/ranking'
import { mapPlayerRankedProfile } from '../mappers/player-ranked.mapper'
import { internalProcedure, router } from '../trpc/trpc'

function withOfficialValhallanTier(
  profile: RankedPlayerProfile | null,
  evidence: PlayerValhallanEvidence | null,
): RankedPlayerProfile | null {
  if (!profile?.snapshot || !evidence) return profile
  const fixedTeams = new Set(
    evidence.fixedTwoVsTwoTeams.map(({ brawlhallaIdOne, brawlhallaIdTwo }) =>
      [brawlhallaIdOne, brawlhallaIdTwo].sort((left, right) => left - right).join(':'),
    ),
  )
  return {
    ...profile,
    snapshot: {
      ...profile.snapshot,
      oneVsOne:
        evidence.oneVsOne && profile.snapshot.oneVsOne.tier.startsWith('Diamond')
          ? { ...profile.snapshot.oneVsOne, tier: 'Valhallan' }
          : profile.snapshot.oneVsOne,
      fixedTeams: profile.snapshot.fixedTeams.map((team) => ({
        ...team,
        tier:
          team.tier.startsWith('Diamond') &&
          fixedTeams.has([team.brawlhallaIdOne, team.brawlhallaIdTwo].sort((left, right) => left - right).join(':'))
            ? 'Valhallan'
            : team.tier,
      })),
      soloQueue: profile.snapshot.soloQueue.map((team) => ({
        ...team,
        tier: evidence.soloTwoVsTwo && team.tier.startsWith('Diamond') ? 'Valhallan' : team.tier,
      })),
    },
  }
}

export function createPlayerRankedRouter(procedure = internalProcedure) {
  return router({
    rankedById: procedure
      .input(playerReferenceByIdInputSchema)
      .output(nullablePlayerRankedProfileSchema)
      .query(async ({ ctx, input }) => {
        const [profile, evidence] = await Promise.all([
          ctx.rankedPlayerQueries.byId(input.id),
          ctx.rankingQueries.playerValhallanEvidenceById(input.id),
        ])
        return mapPlayerRankedProfile(withOfficialValhallanTier(profile, evidence))
      }),
  })
}
