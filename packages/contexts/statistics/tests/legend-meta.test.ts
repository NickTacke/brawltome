import { describe, expect, test } from 'bun:test'
import { launchCohortBrackets, launchCohortRegions } from '../cohort'
import {
  type LegendMetaLegend,
  type LegendMetaObservedPlayer,
  aggregateLegendMetaSlice,
  buildLegendMetaArtifact,
  wilsonInterval95,
} from '../legend-meta'

const legends: LegendMetaLegend[] = [
  { legendId: 3, name: 'Bödvar', slug: 'bodvar' },
  { legendId: 4, name: 'Cassidy', slug: 'cassidy' },
  { legendId: 5, name: 'Orion', slug: 'orion' },
]

function player(
  brawlhallaId: number,
  rating: number,
  observedLegends: LegendMetaObservedPlayer['legends'],
): LegendMetaObservedPlayer {
  return { brawlhallaId, rating, legends: observedLegends }
}

describe('Current Season Legend Meta formulas', () => {
  test('reproduces exact pick share, adoption, game-weighted win rate, median player rating, counts, and coverage', () => {
    const result = aggregateLegendMetaSlice({
      legends,
      selectedPlayers: 5,
      observations: [
        player(1, 1_800, [
          { legendId: 3, games: 100, wins: 60 },
          { legendId: 4, games: 100, wins: 90 },
        ]),
        player(2, 2_000, [{ legendId: 3, games: 100, wins: 40 }]),
        player(3, 2_200, [
          { legendId: 3, games: 0, wins: 0 },
          { legendId: 4, games: 300, wins: 120 },
        ]),
        player(4, 2_400, []),
      ],
    })

    expect(result.coverage).toEqual({ numerator: 4, denominator: 5, basisPoints: 8_000 })
    expect(result.observedPlayers).toBe(4)
    expect(result.observedLegendGames).toBe(600)
    expect(result.rows.find(({ legend }) => legend.legendId === 4)).toMatchObject({
      legend: legends[1],
      playerCount: 2,
      gameCount: 400,
      winCount: 210,
      medianRating: 2_000,
      pickShare: { numerator: 400, denominator: 600, basisPoints: 6_667 },
      adoption: { numerator: 2, denominator: 4, basisPoints: 5_000 },
      winRate: { numerator: 210, denominator: 400, basisPoints: 5_250 },
      eligible: false,
      rank: null,
    })
    expect(result.rows.find(({ legend }) => legend.legendId === 3)).toMatchObject({
      legend: legends[0],
      playerCount: 2,
      gameCount: 200,
      winCount: 100,
      medianRating: 1_900,
      pickShare: { numerator: 200, denominator: 600, basisPoints: 3_333 },
      adoption: { numerator: 2, denominator: 4, basisPoints: 5_000 },
      winRate: { numerator: 100, denominator: 200, basisPoints: 5_000 },
      uncertainty95: { lowerBasisPoints: 4_313, upperBasisPoints: 5_687 },
      eligible: false,
      rank: null,
    })
  })

  test('uses the average of the middle top-level player ratings for an exact even median', () => {
    const result = aggregateLegendMetaSlice({
      legends: legends.slice(0, 1),
      selectedPlayers: 2,
      observations: [
        player(1, 1_900, [{ legendId: 3, games: 1, wins: 0 }]),
        player(2, 2_001, [{ legendId: 3, games: 1, wins: 1 }]),
      ],
    })

    expect(result.rows[0]?.medianRating).toBe(1_950.5)
  })

  test('requires both 30 players and 200 games and ranks only eligible rows by exact pick share', () => {
    const observations = Array.from({ length: 30 }, (_, index) =>
      player(index + 1, 2_000 + index, [
        { legendId: 3, games: index === 0 ? 171 : 1, wins: index % 2 },
        { legendId: 4, games: 7, wins: 3 },
      ]),
    )
    const exact = aggregateLegendMetaSlice({ legends, selectedPlayers: 30, observations })

    expect(exact.rows.find(({ legend }) => legend.legendId === 3)).toMatchObject({
      playerCount: 30,
      gameCount: 200,
      eligible: true,
      rank: 2,
    })
    expect(exact.rows.find(({ legend }) => legend.legendId === 4)).toMatchObject({
      playerCount: 30,
      gameCount: 210,
      eligible: true,
      rank: 1,
    })
    expect(exact.rows.find(({ legend }) => legend.legendId === 5)).toMatchObject({
      playerCount: 0,
      gameCount: 0,
      eligible: false,
      rank: null,
    })

    const tooFewPlayers = aggregateLegendMetaSlice({
      legends: legends.slice(0, 1),
      selectedPlayers: 29,
      observations: observations.slice(0, 29).map((entry) => ({
        ...entry,
        legends: [{ legendId: 3, games: 10, wins: 5 }],
      })),
    })
    const tooFewGames = aggregateLegendMetaSlice({
      legends: legends.slice(0, 1),
      selectedPlayers: 30,
      observations: observations.map((entry, index) => ({
        ...entry,
        legends: [{ legendId: 3, games: index === 0 ? 170 : 1, wins: 0 }],
      })),
    })

    expect(tooFewPlayers.rows[0]).toMatchObject({ playerCount: 29, gameCount: 290, eligible: false, rank: null })
    expect(tooFewGames.rows[0]).toMatchObject({ playerCount: 30, gameCount: 199, eligible: false, rank: null })
  })

  test('keeps zero-observation legends discoverable without inventing denominator-derived values', () => {
    const measuredZero = aggregateLegendMetaSlice({
      legends,
      selectedPlayers: 2,
      observations: [player(1, 2_000, [{ legendId: 3, games: 10, wins: 0 }])],
    })
    const orion = measuredZero.rows.find(({ legend }) => legend.legendId === 5)

    expect(orion).toMatchObject({
      playerCount: 0,
      gameCount: 0,
      winCount: 0,
      medianRating: null,
      pickShare: { numerator: 0, denominator: 10, basisPoints: 0 },
      adoption: { numerator: 0, denominator: 1, basisPoints: 0 },
      winRate: { numerator: 0, denominator: 0, basisPoints: null },
      uncertainty95: null,
      eligible: false,
      rank: null,
    })

    const missing = aggregateLegendMetaSlice({ legends, selectedPlayers: 2, observations: [] })
    expect(missing.coverage).toEqual({ numerator: 0, denominator: 2, basisPoints: 0 })
    expect(missing.rows[0]?.pickShare.basisPoints).toBeNull()
    expect(missing.rows[0]?.adoption.basisPoints).toBeNull()
  })

  test('publishes an outward-rounded 95% Wilson interval and measured zero wins', () => {
    expect(wilsonInterval95(100, 200)).toEqual({ lowerBasisPoints: 4_313, upperBasisPoints: 5_687 })
    expect(wilsonInterval95(0, 200)).toEqual({ lowerBasisPoints: 0, upperBasisPoints: 189 })
    expect(wilsonInterval95(0, 0)).toBeNull()
  })

  test('rejects duplicate players, unknown legends, and contradictory counts instead of changing denominators', () => {
    expect(() =>
      aggregateLegendMetaSlice({
        legends,
        selectedPlayers: 2,
        observations: [player(1, 2_000, []), player(1, 2_000, [])],
      }),
    ).toThrow('duplicate observed player')
    expect(() =>
      aggregateLegendMetaSlice({
        legends,
        selectedPlayers: 1,
        observations: [player(1, 2_000, [{ legendId: 999, games: 1, wins: 1 }])],
      }),
    ).toThrow('unknown legend')
    expect(() =>
      aggregateLegendMetaSlice({
        legends,
        selectedPlayers: 1,
        observations: [player(1, 2_000, [{ legendId: 3, games: 1, wins: 2 }])],
      }),
    ).toThrow('wins cannot exceed games')
  })

  test('materializes every independent all, region, and bracket filter from the same observations', () => {
    let nextPlayerId = 1
    const cells = launchCohortRegions.flatMap((region) =>
      launchCohortBrackets.map((bracket) => {
        const brawlhallaId = nextPlayerId++
        const observedLegends =
          region === 'US-E' && bracket === 'Platinum'
            ? [{ legendId: 3, games: 10, wins: 4 }]
            : region === 'US-E' && bracket === 'Diamond+'
              ? [{ legendId: 4, games: 20, wins: 12 }]
              : region === 'EU' && bracket === 'Platinum'
                ? [{ legendId: 3, games: 30, wins: 20 }]
                : []
        return {
          region,
          bracket,
          selectedPlayers: 2,
          observations: [player(brawlhallaId, 1_800 + brawlhallaId, observedLegends)],
        }
      }),
    )
    const artifact = buildLegendMetaArtifact({
      snapshotId: '10000000-0000-4000-8000-000000000001',
      generationId: '10000000-0000-4000-8000-000000000002',
      cohortMethodologyVersion: 'full-launch-cohort-v1',
      sourceGenerationId: '10000000-0000-4000-8000-000000000003',
      sourceObservedAt: '2026-08-10T00:00:00.000Z',
      observationWindow: {
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: '2026-08-17T00:00:00.000Z',
      },
      publishedAt: '2026-08-12T00:00:00.000Z',
      legends,
      cells,
    })

    expect(artifact.slices).toHaveLength(30)
    expect(artifact.expectedNextPublicationAt).toBe('2026-08-19T00:00:00.000Z')
    expect(artifact.season).toEqual({
      scope: 'current-season',
      identity: null,
      source: 'brawlhalla-v1-ranked-1v1',
    })
    expect(artifact.slices.find(({ region, bracket }) => region === 'all' && bracket === 'all')).toMatchObject({
      selectedPlayers: 36,
      observedPlayers: 18,
      observedLegendGames: 60,
    })
    expect(artifact.slices.find(({ region, bracket }) => region === 'US-E' && bracket === 'all')).toMatchObject({
      selectedPlayers: 4,
      observedPlayers: 2,
      observedLegendGames: 30,
    })
    expect(artifact.slices.find(({ region, bracket }) => region === 'all' && bracket === 'Platinum')).toMatchObject({
      selectedPlayers: 18,
      observedPlayers: 9,
      observedLegendGames: 40,
    })
    expect(artifact.slices.find(({ region, bracket }) => region === 'EU' && bracket === 'Platinum')).toMatchObject({
      selectedPlayers: 2,
      observedPlayers: 1,
      observedLegendGames: 30,
    })
  })

  test('rejects a player repeated across launch cells instead of double-counting all-region adoption', () => {
    const cells = launchCohortRegions.flatMap((region) =>
      launchCohortBrackets.map((bracket) => ({
        region,
        bracket,
        selectedPlayers: 1,
        observations: [
          player(region === 'EU' || region === 'US-E' ? 1 : launchCohortRegions.indexOf(region) + 2, 2_000, []),
        ],
      })),
    )

    expect(() =>
      buildLegendMetaArtifact({
        snapshotId: '10000000-0000-4000-8000-000000000001',
        generationId: '10000000-0000-4000-8000-000000000002',
        cohortMethodologyVersion: 'full-launch-cohort-v1',
        sourceGenerationId: '10000000-0000-4000-8000-000000000003',
        sourceObservedAt: '2026-08-10T00:00:00.000Z',
        observationWindow: {
          startsAt: '2026-08-10T00:00:00.000Z',
          endsAt: '2026-08-17T00:00:00.000Z',
        },
        publishedAt: '2026-08-12T00:00:00.000Z',
        legends,
        cells,
      }),
    ).toThrow('duplicate player across launch cells')
  })
})
