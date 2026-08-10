import { describe, expect, test } from 'bun:test'
import {
  type LegendMetaOutput,
  legendMetaInputSchema,
  legendMetaOutputSchema,
  parseLegendMetaOutput,
} from '../src/statistics'

const available: LegendMetaOutput = {
  status: 'fresh',
  staleReason: null,
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  methodologyVersion: 'current-season-legend-meta-v1',
  cohortMethodologyVersion: 'full-launch-cohort-v1',
  sourceGenerationId: '10000000-0000-4000-8000-000000000003',
  sourceObservedAt: '2026-08-10T00:00:00.000Z',
  observationWindow: {
    startsAt: '2026-08-10T00:00:00.000Z',
    endsAt: '2026-08-17T00:00:00.000Z',
  },
  publishedAt: '2026-08-12T00:00:00.000Z',
  expectedNextPublicationAt: '2026-08-19T00:00:00.000Z',
  season: {
    scope: 'current-season',
    identity: null,
    source: 'brawlhalla-v1-ranked-1v1',
  },
  filter: { region: 'all', bracket: 'Platinum' },
  selectedPlayers: 125,
  observedPlayers: 119,
  observedLegendGames: 1_190,
  coverage: { numerator: 119, denominator: 125, basisPoints: 9_520 },
  methodology: {
    population: 'deterministic-observed-cohort',
    seasonalScope: 'Cumulative current-season ranked 1v1 values observed during the collection window.',
    formulas: {
      pickShare: 'Observed legend games divided by all observed legend games in the selected filter.',
      adoption:
        'Observed players with games on the legend divided by players with a successful ranked observation in the selected filter.',
      winRate: 'Observed legend wins divided by observed legend games, weighted by games.',
      medianRating: 'Median current 1v1 player rating among observed players with games on the legend.',
      coverage: 'Successful ranked observations divided by selected Observed Cohort players.',
      uncertainty: '95% Wilson score interval over observed legend wins and games.',
    },
    eligibility: {
      minimumPlayers: 30,
      minimumGames: 200,
      rule: 'A row needs both minimums to receive a comparative rank.',
    },
    trends: { status: 'disabled', reason: 'season-identity-unavailable' },
    caveats: [
      'BrawlTome-observed values are not exhaustive or live.',
      'Missing source observations reduce coverage and are not counted as zero games.',
      'The source does not expose a stable season identity, so cross-publication trends are unavailable.',
      'Observed win rate describes this cohort and does not establish legend strength or causation.',
    ],
  },
  rows: [
    {
      legend: { legendId: 3, name: 'BÖDVAR', slug: 'bodvar' },
      rank: null,
      eligibility: { status: 'insufficient-sample', minimumPlayers: 30, minimumGames: 200 },
      playerCount: 0,
      gameCount: 0,
      winCount: 0,
      medianRating: null,
      pickShare: { numerator: 0, denominator: 1_190, basisPoints: 0 },
      adoption: { numerator: 0, denominator: 119, basisPoints: 0 },
      winRate: { numerator: 0, denominator: 0, basisPoints: null },
      uncertainty95: null,
    },
    {
      legend: { legendId: 4, name: 'CASSIDY', slug: 'cassidy' },
      rank: 1,
      eligibility: { status: 'eligible' },
      playerCount: 119,
      gameCount: 1_190,
      winCount: 595,
      medianRating: 1_800,
      pickShare: { numerator: 1_190, denominator: 1_190, basisPoints: 10_000 },
      adoption: { numerator: 119, denominator: 119, basisPoints: 10_000 },
      winRate: { numerator: 595, denominator: 1_190, basisPoints: 5_000 },
      uncertainty95: { lowerBasisPoints: 4_716, upperBasisPoints: 5_284 },
    },
  ],
}

describe('Current Season Legend Meta contract', () => {
  test('accepts only independent launch region and current 1v1 bracket filters', () => {
    expect(legendMetaInputSchema.parse({ region: 'all', bracket: 'all' })).toEqual({ region: 'all', bracket: 'all' })
    expect(legendMetaInputSchema.parse({ region: 'EU', bracket: 'Diamond+' })).toEqual({
      region: 'EU',
      bracket: 'Diamond+',
    })
    expect(() => legendMetaInputSchema.parse({ region: 'GLOBAL', bracket: 'Gold' })).toThrow()
    expect(() => legendMetaInputSchema.parse({ region: 'EU', bracket: 'Platinum', season: 38 })).toThrow()
  })

  test('preserves exact ratios, explicit insufficiency, missing derived values, and methodology', () => {
    expect(parseLegendMetaOutput(available)).toEqual(available)
  })

  test('requires stale warnings and keeps unavailable distinct from an empty measured publication', () => {
    expect(
      legendMetaOutputSchema.parse({
        status: 'unavailable',
        reason: 'not_yet_published',
        filter: { region: 'all', bracket: 'all' },
      }),
    ).toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: 'all', bracket: 'all' },
    })
    expect(
      legendMetaOutputSchema.parse({ ...available, status: 'stale', staleReason: 'latest_build_failed' }),
    ).toMatchObject({ status: 'stale', staleReason: 'latest_build_failed', rows: available.rows })
    expect(() =>
      legendMetaOutputSchema.parse({ ...available, status: 'fresh', staleReason: 'publication_overdue' }),
    ).toThrow()
  })

  test('rejects invented ranks, percentages, uncertainty, or trend fields', () => {
    expect(() =>
      legendMetaOutputSchema.parse({
        ...available,
        rows: [
          {
            ...available.rows[0],
            rank: 1,
            winRate: { numerator: 0, denominator: 0, basisPoints: 0 },
          },
        ],
      }),
    ).toThrow()
    expect(() => legendMetaOutputSchema.parse({ ...available, trend: { direction: 'up' } })).toThrow()
    expect(() =>
      legendMetaOutputSchema.parse({
        ...available,
        rows: [{ ...available.rows[0], uncertainty95: { lowerBasisPoints: 6_000, upperBasisPoints: 5_000 } }],
      }),
    ).toThrow()
    expect(() =>
      legendMetaOutputSchema.parse({
        ...available,
        rows: available.rows.map((row, index) =>
          index === 1 ? { ...row, uncertainty95: { lowerBasisPoints: 0, upperBasisPoints: 10_000 } } : row,
        ),
      }),
    ).toThrow()
  })
})
