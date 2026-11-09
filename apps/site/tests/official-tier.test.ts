import { describe, expect, test } from 'bun:test'
import type { PlayerRankedProfileContract, PlayerValhallanEvidenceContract } from '@brawltome/contracts'
import { withOfficialValhallanTier } from '../src/server/official-tier'

const values = { rating: 2100, peakRating: 2200, wins: 10, games: 20 }
const teamBase = { ...values, teamName: 'Team', region: 'EU', globalRank: null }

function profile(oneVsOneTier: string, teamTier: string, soloTier: string): PlayerRankedProfileContract {
  return {
    brawlhallaId: 7,
    checkedAt: '2026-11-01T12:00:00.000Z',
    lastSuccessAt: '2026-11-01T12:00:00.000Z',
    freshness: 'fresh',
    freshForSeconds: 3600,
    sparsePulse: null,
    snapshot: {
      oneVsOne: { ...values, tier: oneVsOneTier, region: 'EU', globalRank: null, regionRank: null },
      rankedLegends: [],
      mainLegend: null,
      fixedTeams: [{ ...teamBase, tier: teamTier, brawlhallaIdOne: 7, brawlhallaIdTwo: 9 }],
      soloQueue: [{ ...teamBase, tier: soloTier, secondPlayerId: 0 }],
      ratingHistory: [],
      observedRatingDirection: null,
    },
  }
}

const noEvidence: PlayerValhallanEvidenceContract = { oneVsOne: false, fixedTwoVsTwoTeams: [], soloTwoVsTwo: false }

function tiers(result: PlayerRankedProfileContract | null) {
  const snapshot = result?.snapshot

  return [snapshot?.oneVsOne.tier, snapshot?.fixedTeams[0]?.tier, snapshot?.soloQueue[0]?.tier]
}

describe('withOfficialValhallanTier', () => {
  test('1v1 evidence turns Diamond into Valhallan', () => {
    const result = withOfficialValhallanTier(profile('Diamond', 'Diamond', 'Diamond'), {
      ...noEvidence,
      oneVsOne: true,
    })

    expect(tiers(result)).toEqual(['Valhallan', 'Diamond', 'Diamond'])
  })

  test('1v1 evidence leaves Platinum alone', () => {
    const result = withOfficialValhallanTier(profile('Platinum 3', 'Diamond', 'Diamond'), {
      ...noEvidence,
      oneVsOne: true,
    })

    expect(tiers(result)[0]).toBe('Platinum 3')
  })

  test('a fixed team matches with its ids in either order', () => {
    const fixedTwoVsTwoTeams = [{ brawlhallaIdOne: 9, brawlhallaIdTwo: 7 }]

    const result = withOfficialValhallanTier(profile('Diamond', 'Diamond', 'Diamond'), {
      ...noEvidence,
      fixedTwoVsTwoTeams,
    })

    expect(tiers(result)).toEqual(['Diamond', 'Valhallan', 'Diamond'])
  })

  test('solo evidence changes only solo teams', () => {
    const result = withOfficialValhallanTier(profile('Diamond', 'Diamond', 'Diamond'), {
      ...noEvidence,
      soloTwoVsTwo: true,
    })

    expect(tiers(result)).toEqual(['Diamond', 'Diamond', 'Valhallan'])
  })

  test('no evidence returns the profile unchanged', () => {
    const original = profile('Diamond', 'Diamond', 'Diamond')

    expect(withOfficialValhallanTier(original, null)).toBe(original)
  })

  test('no profile stays no profile', () => {
    expect(withOfficialValhallanTier(null, noEvidence)).toBeNull()
  })
})
