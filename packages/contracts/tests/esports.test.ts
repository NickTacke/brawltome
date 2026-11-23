import { describe, expect, test } from 'bun:test'
import { type PlayerEsportsContract, playerEsportsSchema } from '../src/esports'

const win = {
  id: '9',
  isWin: true,
  isForfeit: false,
  score: '3-1',
  opponents: [{ brawlhallaId: 7, name: 'Sandstorm' }],
  legendKey: 'mordex',
  opponentLegendKey: null,
}

const forfeit = {
  ...win,
  id: '10',
  isForfeit: true,
  score: 'DQ',
  opponents: [{ brawlhallaId: null, name: 'No Show' }],
  legendKey: null,
}

const result = {
  id: '1v1-tournament/frostbyte-19/event/1v1',
  tournamentId: 'tournament/frostbyte-19/event/1v1',
  mode: '1v1' as const,
  placement: 3,
  fullName: 'Frostbyte #19',
  heading: 'Frostbyte',
  title: 'Frostbyte #19',
  meta: 'Mar 2026',
  startTime: 1_773_511_200,
  isOfficial: false,
  isOnline: true,
  legendKey: 'mordex',
  sets: [win, forfeit],
  setRecord: { wins: 1, losses: 0 },
}

const ranking = { mode: '1v1' as const, rank: 14, region: 'EU', gold: 1, silver: 0, bronze: 2, top8: 6 }
const profile = { earnings: 120.5, rankings: [ranking], results: [result] }

describe('player esports contract', () => {
  test('accepts a profile with its rankings, results and sets', () => {
    const esports: PlayerEsportsContract = { profile, freshness: 'fresh' }

    expect(playerEsportsSchema.parse(esports)).toEqual(esports)
  })

  test('accepts no profile, no earnings, no record and no legend', () => {
    const quiet = { ...result, legendKey: null, sets: [], setRecord: null }

    expect(playerEsportsSchema.parse({ profile: null, freshness: 'missing' })).toEqual({
      profile: null,
      freshness: 'missing',
    })

    expect(
      playerEsportsSchema.parse({ profile: { earnings: null, rankings: [], results: [quiet] }, freshness: 'stale' }),
    ).toEqual({ profile: { earnings: null, rankings: [], results: [quiet] }, freshness: 'stale' })
  })

  test('rejects an unknown freshness, an unknown mode and a placement of zero', () => {
    expect(() => playerEsportsSchema.parse({ profile: null, freshness: 'old' })).toThrow()

    const threes = { ...profile, results: [{ ...result, mode: '3v3' }] }
    const zeroth = { ...profile, results: [{ ...result, placement: 0 }] }

    expect(() => playerEsportsSchema.parse({ profile: threes, freshness: 'fresh' })).toThrow()
    expect(() => playerEsportsSchema.parse({ profile: zeroth, freshness: 'fresh' })).toThrow()
  })

  test('rejects zero earnings, which the profile sends as null', () => {
    expect(() => playerEsportsSchema.parse({ profile: { ...profile, earnings: 0 }, freshness: 'fresh' })).toThrow()
  })

  test('rejects an unknown field at every level', () => {
    const withExtraSet = { ...result, sets: [{ ...win, extra: true }] }
    const withExtraOpponent = { ...result, sets: [{ ...win, opponents: [{ ...win.opponents[0], extra: true }] }] }

    expect(() => playerEsportsSchema.parse({ profile, freshness: 'fresh', extra: true })).toThrow()
    expect(() => playerEsportsSchema.parse({ profile: { ...profile, extra: true }, freshness: 'fresh' })).toThrow()

    expect(() =>
      playerEsportsSchema.parse({ profile: { ...profile, results: [withExtraSet] }, freshness: 'fresh' }),
    ).toThrow()

    expect(() =>
      playerEsportsSchema.parse({ profile: { ...profile, results: [withExtraOpponent] }, freshness: 'fresh' }),
    ).toThrow()
  })
})
