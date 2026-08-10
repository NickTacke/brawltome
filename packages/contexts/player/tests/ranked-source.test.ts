import { describe, expect, test } from 'bun:test'
import { decodeV0RankedSnapshot } from '../ranked/source'

const completeSnapshot = {
  name: 'Measured Zero',
  brawlhalla_id: 91913839,
  rating: 0,
  peak_rating: 782,
  tier: 'Tin 0',
  wins: 0,
  games: 0,
  region: 'US-E',
  global_rank: 0,
  region_rank: 0,
  legends: [
    {
      legend_id: 3,
      legend_name_key: 'bodvar',
      rating: 782,
      peak_rating: 782,
      tier: 'Tin 0',
      wins: 0,
      games: 0,
    },
  ],
  '2v2': [
    {
      brawlhalla_id_one: 91913839,
      brawlhalla_id_two: 42,
      rating: 1500,
      peak_rating: 1510,
      tier: 'Gold 1',
      wins: 4,
      games: 9,
      teamname: 'Measured Zero + Partner',
      region: 2,
      global_rank: 0,
    },
    {
      brawlhalla_id_one: 91913839,
      brawlhalla_id_two: 0,
      rating: 1670,
      peak_rating: 1670,
      tier: 'Gold 5',
      wins: 2,
      games: 2,
      teamname: 'Solo Queue',
      region: 3,
      global_rank: 0,
    },
  ],
}

describe('V0 ranked snapshot source contract', () => {
  test('maps a complete snapshot without blending measured zero, fixed teams, or Solo Queue', () => {
    expect(decodeV0RankedSnapshot(completeSnapshot, 91913839)).toEqual({
      brawlhallaId: 91913839,
      name: 'Measured Zero',
      oneVsOne: {
        rating: 0,
        peakRating: 782,
        tier: 'Tin 0',
        wins: 0,
        games: 0,
        region: 'US-E',
        globalRank: null,
        regionRank: null,
      },
      rankedLegends: [
        {
          legendId: 3,
          legendNameKey: 'bodvar',
          rating: 782,
          peakRating: 782,
          tier: 'Tin 0',
          wins: 0,
          games: 0,
        },
      ],
      rankedMainLegend: null,
      fixedTeams: [
        {
          brawlhallaIdOne: 91913839,
          brawlhallaIdTwo: 42,
          teamName: 'Measured Zero + Partner',
          rating: 1500,
          peakRating: 1510,
          tier: 'Gold 1',
          wins: 4,
          games: 9,
          region: 'US-E',
          globalRank: null,
        },
      ],
      soloQueue: [
        {
          secondPlayerId: 0,
          teamName: 'Solo Queue',
          rating: 1670,
          peakRating: 1670,
          tier: 'Gold 5',
          wins: 2,
          games: 2,
          region: 'EU',
          globalRank: null,
        },
      ],
    })
  })

  test('accepts authoritative empty arrays and preserves multiple Solo Queue rows in source order', () => {
    const secondSolo = {
      ...completeSnapshot['2v2'][1],
      rating: 1600,
      region: 4,
      teamname: 'Solo Queue Alternate',
    }
    const decoded = decodeV0RankedSnapshot(
      { ...completeSnapshot, legends: [], '2v2': [completeSnapshot['2v2'][1], secondSolo] },
      91913839,
    )

    expect(decoded.rankedLegends).toEqual([])
    expect(decoded.fixedTeams).toEqual([])
    expect(decoded.soloQueue.map(({ teamName, region }) => ({ teamName, region }))).toEqual([
      { teamName: 'Solo Queue', region: 'EU' },
      { teamName: 'Solo Queue Alternate', region: 'SEA' },
    ])
  })

  test.each([
    { ...completeSnapshot, legends: undefined },
    { ...completeSnapshot, '2v2': undefined },
    { ...completeSnapshot, region: 'JPS' },
    {
      ...completeSnapshot,
      '2v2': [{ ...completeSnapshot['2v2'][0], region: 99 }],
    },
    {
      ...completeSnapshot,
      '2v2': [
        completeSnapshot['2v2'][0],
        {
          ...completeSnapshot['2v2'][0],
          brawlhalla_id_one: completeSnapshot['2v2'][0].brawlhalla_id_two,
          brawlhalla_id_two: completeSnapshot['2v2'][0].brawlhalla_id_one,
        },
      ],
    },
  ])('rejects malformed or partial complete snapshots %#', (payload) => {
    expect(() => decodeV0RankedSnapshot(payload, 91913839)).toThrow()
  })
})
