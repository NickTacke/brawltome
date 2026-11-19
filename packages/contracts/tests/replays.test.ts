import { describe, expect, test } from 'bun:test'
import { matchDetailSchema, matchSummarySchema, myMatchesSchema } from '../src/replays'

const player = {
  slot: 1,
  brawlhallaId: 1001,
  name: 'Alpha',
  team: 0,
  legendId: 65,
  legendName: 'Imugi',
  legendKey: 'imugi',
  damageDealt: 322.22,
  damageTaken: 547.65,
  kos: 1,
  deaths: 4,
  suicides: 0,
  teamKos: 0,
  clashes: 1,
  dodges: 8,
  airDodges: 7,
  jumps: 105,
  airJumps: 70,
  dashes: 19,
  dashJumps: 1,
  timeInAirMs: 122256,
  timeOnGroundMs: 29520,
  timeOnWallMs: 1600,
  score: 38,
  weapons: { Axe: { Uses: 12 } },
  isWinner: false,
}

// a match as the api answered before it sent insights, art and playback
const earlierMatch = {
  id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
  patch: '11.00',
  mapName: 'Big Crystal Temple',
  modeName: 'Stock',
  isRanked: true,
  isCustom: false,
  durationMs: 187000,
  parsedAt: '2026-11-13T20:00:00.000Z',
  mapPictureUrl: 'https://art.brawltome.app/sheets/0a595e48e9f677f4.webp',
  queue: 'ranked',
  hasTeams: false,
  hasTeamDamage: false,
  stocks: 3,
  isReliable: true,
  failedChecks: [],
  players: [player],
  replay: { available: true, patch: '11.00', fileName: '[11.00] BigCrystalTemple.replay' },
}

const art = {
  state: 'ready' as const,
  manifestUrl: 'https://art.brawltome.app/matches/6f9a7f4e/dev-1-lease/manifest.json',
  baseUrl: 'https://art.brawltome.app',
}

describe('match detail', () => {
  test('every answer carries insights, art and playback', () => {
    expect(matchDetailSchema.safeParse(earlierMatch).success).toBe(false)
  })

  test('an answer with insights, art and playback reads', () => {
    const match = { ...earlierMatch, insights: null, art, playbackPath: `/match/${earlierMatch.id}/playback/dev-1` }

    expect(matchDetailSchema.parse(match)).toEqual(match)
  })

  test('art without a bucket has no addresses', () => {
    const art = { state: 'none', manifestUrl: null, baseUrl: null }
    const match = { ...earlierMatch, insights: null, art, playbackPath: null }

    expect(matchDetailSchema.safeParse(match).success).toBe(true)
  })

  test('an art state the api never sends is refused', () => {
    const match = { ...earlierMatch, insights: null, art: { ...art, state: 'exporting' }, playbackPath: null }

    expect(matchDetailSchema.safeParse(match).success).toBe(false)
  })
})

const summary = {
  id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
  patch: '11.01',
  mapName: 'Mishima Dojo',
  modeName: 'Stock',
  isRanked: true,
  isCustom: false,
  queue: 'ranked',
  hasTeams: false,
  stocks: 3,
  durationMs: 90192,
  parsedAt: '2026-11-18T21:58:39.205Z',
  mapPictureUrl: null,
  players: [
    {
      slot: 1,
      brawlhallaId: 1001,
      name: 'Alpha',
      team: 0,
      legendId: 3,
      legendName: 'Ember',
      legendKey: 'ember',
      kos: 3,
      deaths: 1,
      damageDealt: 287.4,
      score: null,
      isWinner: true,
    },
    {
      slot: 2,
      brawlhallaId: 1002,
      name: 'Bravo',
      team: 0,
      legendId: 7,
      legendName: 'Kor',
      legendKey: 'kor',
      kos: 1,
      deaths: 3,
      damageDealt: 176,
      score: null,
      isWinner: false,
    },
  ],
}

describe('match summary', () => {
  test('a row of a match list reads with its result and the map picture still to come', () => {
    expect(matchSummarySchema.parse(summary)).toEqual(summary)
  })

  test('a player without a result is refused', () => {
    const { isWinner: _isWinner, ...withoutResult } = summary.players[0] as (typeof summary.players)[number]

    expect(matchSummarySchema.safeParse({ ...summary, players: [withoutResult] }).success).toBe(false)
  })
})

describe('my matches', () => {
  test('a visitor with no verified player has an empty record and no matches', () => {
    const empty = {
      player: null,
      record: { games: 0, wins: 0, lastParsedAt: null, legends: [] },
      matches: [],
      nextCursor: null,
    }

    expect(myMatchesSchema.parse(empty)).toEqual(empty)
  })

  test('a record counts each legend played with its wins', () => {
    const mine = {
      player: { brawlhallaId: 1001, name: 'Alpha' },
      record: {
        games: 1,
        wins: 1,
        lastParsedAt: summary.parsedAt,
        legends: [{ legendId: 3, legendName: 'Ember', legendKey: 'ember', games: 1, wins: 1 }],
      },
      matches: [summary],
      nextCursor: null,
    }

    expect(myMatchesSchema.parse(mine)).toEqual(mine)
  })
})
