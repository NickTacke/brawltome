import { describe, expect, test } from 'bun:test'
import {
  bestTeam,
  combinedRecord,
  hasSoloQueue,
  rankedStanding,
  sortTeams,
  teammateOf,
} from '../src/components/player/side-summary'

const team = { rating: 1800, peakRating: 1900, tier: 'Platinum 1', wins: 30, games: 50, region: 'EU', globalRank: null }

function fixedTeam(rating: number, wins = 30, games = 50) {
  return { ...team, rating, wins, games, brawlhallaIdOne: 7, brawlhallaIdTwo: 9, teamName: 'Seven+Nine' }
}

describe('teammateOf', () => {
  test('returns the second player from the first position', () => {
    expect(teammateOf(fixedTeam(1800), 7)).toEqual({ id: 9, name: 'Nine' })
  })

  test('returns the first player from the second position', () => {
    expect(teammateOf(fixedTeam(1800), 9)).toEqual({ id: 7, name: 'Seven' })
  })
})

describe('combinedRecord', () => {
  test('is empty with no teams', () => {
    expect(combinedRecord([])).toEqual({ teams: 0, wins: 0, games: 0 })
  })

  test('adds every team', () => {
    expect(combinedRecord([fixedTeam(1800), fixedTeam(1700, 5, 10)])).toEqual({ teams: 2, wins: 35, games: 60 })
  })
})

describe('bestTeam', () => {
  test('is the highest rated', () => {
    expect(bestTeam([fixedTeam(1500), fixedTeam(1800)])?.rating).toBe(1800)
  })

  test('is nothing with no teams', () => {
    expect(bestTeam([])).toBeNull()
  })
})

describe('hasSoloQueue', () => {
  test('is false when the entry has no games', () => {
    expect(hasSoloQueue([{ ...team, games: 0, wins: 0, secondPlayerId: 0, teamName: '' }])).toBe(false)
  })

  test('is true with games played', () => {
    expect(hasSoloQueue([{ ...team, secondPlayerId: 0, teamName: '' }])).toBe(true)
  })
})

describe('rankedStanding', () => {
  test('is nothing without a profile', () => {
    expect(rankedStanding(null)).toBeNull()
  })

  test('is nothing without a snapshot', () => {
    const profile = {
      brawlhallaId: 7,
      checkedAt: '2026-11-01T12:00:00.000Z',
      lastSuccessAt: null,
      freshness: 'unavailable' as const,
      freshForSeconds: 3600,
      sparsePulse: null,
      snapshot: null,
    }

    expect(rankedStanding(profile)).toBeNull()
  })
})

describe('sortTeams', () => {
  const teams = [
    { ...fixedTeam(1800, 10, 20), peakRating: 1850 },
    { ...fixedTeam(1700, 30, 40), peakRating: 2000 },
    { ...fixedTeam(1600, 5, 60), peakRating: 1590 },
  ]

  function ratings(sorted: ReturnType<typeof sortTeams>): number[] {
    return sorted.map((team) => team.rating)
  }

  test.each([
    ['elo', [1800, 1700, 1600]],
    ['peak', [1700, 1800, 1600]],
    ['games', [1600, 1700, 1800]],
    ['winRate', [1700, 1800, 1600]],
  ] as const)('%s', (sort, expected) => {
    expect(ratings(sortTeams(teams, sort))).toEqual([...expected])
  })

  test('peak uses the rating when the stored peak is below it', () => {
    const lagging = { ...fixedTeam(1900), peakRating: 1800 }
    const higherPeak = { ...fixedTeam(1500), peakRating: 1850 }

    expect(ratings(sortTeams([higherPeak, lagging], 'peak'))).toEqual([1900, 1500])
  })
})
