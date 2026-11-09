import { describe, expect, test } from 'bun:test'
import {
  bestTeam,
  combinedRecord,
  hasSoloQueue,
  rankedStanding,
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
