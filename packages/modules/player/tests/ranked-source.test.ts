import { describe, expect, test } from 'bun:test'
import { decodeV0RankedSnapshot, decodeV1FixedTeamPulses, decodeV1OneVsOnePulse } from '../ranked/source'

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

  test('preserves an unranked snapshot while treating its blank name as absent identity evidence', () => {
    expect(
      decodeV0RankedSnapshot(
        { ...completeSnapshot, name: '', peak_rating: 0, tier: 'none', region: 'none', legends: [], '2v2': [] },
        91913839,
      ),
    ).toMatchObject({ name: null, oneVsOne: { rating: 0, peakRating: 0, tier: 'none', region: '' } })
  })

  test('omits impossible provider self-teams without discarding valid ranked data', () => {
    const selfTeam = {
      ...completeSnapshot['2v2'][0],
      brawlhalla_id_two: completeSnapshot.brawlhalla_id,
      teamname: 'Invalid Self Team',
    }
    const decoded = decodeV0RankedSnapshot(
      { ...completeSnapshot, '2v2': [completeSnapshot['2v2'][0], selfTeam, selfTeam] },
      completeSnapshot.brawlhalla_id,
    )

    expect(decoded.fixedTeams).toHaveLength(1)
    expect(decoded.fixedTeams[0]).toMatchObject({ brawlhallaIdOne: 91913839, brawlhallaIdTwo: 42 })
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
      '2v2': [{ ...completeSnapshot['2v2'][0], brawlhalla_id_one: 42, brawlhalla_id_two: 42 }],
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

describe('V1 ranked pulse source contract', () => {
  test('decodes only sparse approved 1v1 scalars without requiring unsupported fields', () => {
    expect(
      decodeV1OneVsOnePulse(
        {
          brawlhalla_id: 91913839,
          rating: 2010,
          games: 73,
          tier: { malformed: true },
          region: 42,
          global_rank: -1,
          legends: 'not-used-by-pulses',
        },
        91913839,
      ),
    ).toEqual({ rating: 2010, games: 73 })
  })

  test.each([{ brawlhalla_id: 91913839 }, { brawlhalla_id: 91913839, peak_rating: undefined }])(
    'treats an empty 1v1 pulse as a no-op %#',
    (payload) => {
      expect(decodeV1OneVsOnePulse(payload, 91913839)).toBeNull()
    },
  )

  test.each([
    { brawlhalla_id: 42, rating: 1800 },
    { brawlhalla_id: 91913839, rating: -1 },
    { brawlhalla_id: 91913839, peak_rating: 1.5 },
    { brawlhalla_id: 91913839, wins: '5' },
    { brawlhalla_id: 91913839, games: Number.NaN },
  ])('rejects malformed approved 1v1 pulse evidence %#', (payload) => {
    expect(() => decodeV1OneVsOnePulse(payload, 91913839)).toThrow()
  })

  test('decodes sparse fixed-team scalars, normalizes composition, and ignores Solo Queue', () => {
    expect(
      decodeV1FixedTeamPulses(
        {
          brawlhalla_id: 91913839,
          teams: {
            ranked_2v2: [
              {
                brawlhalla_id_one: 42,
                brawlhalla_id_two: 91913839,
                rating: 1777,
                wins: 11,
                tier: null,
                region: 99,
                username_one: 12,
              },
              {
                brawlhalla_id_one: 91913839,
                brawlhalla_id_two: 0,
                rating: 1900,
                games: 3,
              },
            ],
          },
        },
        91913839,
      ),
    ).toEqual([
      {
        brawlhallaIdOne: 42,
        brawlhallaIdTwo: 91913839,
        values: { rating: 1777, wins: 11 },
      },
    ])
  })

  test.each([
    null,
    { brawlhalla_id: 91913839 },
    { brawlhalla_id: 91913839, teams: {} },
    { brawlhalla_id: 91913839, teams: { ranked_2v2: undefined } },
  ])('treats absent optional team evidence as a no-op %#', (payload) => {
    expect(decodeV1FixedTeamPulses(payload, 91913839)).toEqual([])
  })

  test.each([
    {
      brawlhalla_id: 91913839,
      teams: { ranked_2v2: [{ brawlhalla_id_one: 91913839, brawlhalla_id_two: 42, rating: -1 }] },
    },
    {
      brawlhalla_id: 91913839,
      teams: { ranked_2v2: [{ brawlhalla_id_one: 7, brawlhalla_id_two: 42, rating: 1700 }] },
    },
    {
      brawlhalla_id: 91913839,
      teams: {
        ranked_2v2: [
          { brawlhalla_id_one: 91913839, brawlhalla_id_two: 42, rating: 1700 },
          { brawlhalla_id_one: 42, brawlhalla_id_two: 91913839, games: 10 },
        ],
      },
    },
  ])('rejects malformed fixed-team pulse evidence atomically %#', (payload) => {
    expect(() => decodeV1FixedTeamPulses(payload, 91913839)).toThrow()
  })
})
