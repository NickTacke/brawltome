import { describe, expect, test } from 'bun:test'
import { matchDetailSchema } from '../src/replays'

const player = {
  slot: 1,
  brawlhallaId: 1001,
  name: 'Alpha',
  team: 0,
  legendId: 65,
  legendName: 'IMUGI',
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
  test('an answer without insights, art and playback still reads', () => {
    expect(matchDetailSchema.safeParse(earlierMatch).success).toBe(true)
  })

  test('an answer with insights, art and playback reads', () => {
    const match = { ...earlierMatch, insights: null, art, playbackPath: `/match/${earlierMatch.id}/playback/dev-1` }

    expect(matchDetailSchema.parse(match)).toEqual(match)
  })

  test('art without a bucket has no addresses', () => {
    const match = { ...earlierMatch, art: { state: 'none', manifestUrl: null, baseUrl: null } }

    expect(matchDetailSchema.safeParse(match).success).toBe(true)
  })

  test('an art state the api never sends is refused', () => {
    const match = { ...earlierMatch, art: { ...art, state: 'exporting' } }

    expect(matchDetailSchema.safeParse(match).success).toBe(false)
  })
})
