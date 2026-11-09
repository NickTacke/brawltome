import type { PlayerRankedProfileContract, PlayerValhallanEvidenceContract } from '@brawltome/contracts'

type RankedSnapshot = NonNullable<PlayerRankedProfileContract['snapshot']>

function teamKey(playerOne: number, playerTwo: number): string {
  return [playerOne, playerTwo].sort((left, right) => left - right).join(':')
}

function isDiamond(tier: string): boolean {
  return tier.startsWith('Diamond')
}

function withFixedTeamTiers(
  teams: RankedSnapshot['fixedTeams'],
  evidence: PlayerValhallanEvidenceContract,
): RankedSnapshot['fixedTeams'] {
  const valhallanTeams = new Set(
    evidence.fixedTwoVsTwoTeams.map(({ brawlhallaIdOne, brawlhallaIdTwo }) =>
      teamKey(brawlhallaIdOne, brawlhallaIdTwo),
    ),
  )

  return teams.map((team) => {
    const isValhallan = isDiamond(team.tier) && valhallanTeams.has(teamKey(team.brawlhallaIdOne, team.brawlhallaIdTwo))

    return isValhallan ? { ...team, tier: 'Valhallan' } : team
  })
}

function withSoloQueueTiers(
  teams: RankedSnapshot['soloQueue'],
  evidence: PlayerValhallanEvidenceContract,
): RankedSnapshot['soloQueue'] {
  if (!evidence.soloTwoVsTwo) return teams

  return teams.map((team) => (isDiamond(team.tier) ? { ...team, tier: 'Valhallan' } : team))
}

function withOneVsOneTier(
  oneVsOne: RankedSnapshot['oneVsOne'],
  evidence: PlayerValhallanEvidenceContract,
): RankedSnapshot['oneVsOne'] {
  return evidence.oneVsOne && isDiamond(oneVsOne.tier) ? { ...oneVsOne, tier: 'Valhallan' } : oneVsOne
}

/** The game's API stops at Diamond, so Valhallan comes from the official boards. */
export function withOfficialValhallanTier(
  profile: PlayerRankedProfileContract | null,
  evidence: PlayerValhallanEvidenceContract | null,
): PlayerRankedProfileContract | null {
  if (!profile?.snapshot || !evidence) return profile

  return {
    ...profile,
    snapshot: {
      ...profile.snapshot,
      oneVsOne: withOneVsOneTier(profile.snapshot.oneVsOne, evidence),
      fixedTeams: withFixedTeamTiers(profile.snapshot.fixedTeams, evidence),
      soloQueue: withSoloQueueTiers(profile.snapshot.soloQueue, evidence),
    },
  }
}
