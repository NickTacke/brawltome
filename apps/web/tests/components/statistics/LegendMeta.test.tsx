import { describe, expect, test } from 'bun:test'
import type { LegendMetaOutput } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegendMetaView } from '../../../src/components/statistics/LegendMetaView'

type AvailableLegendMeta = Exclude<LegendMetaOutput, { status: 'unavailable' }>

const methodology: AvailableLegendMeta['methodology'] = {
  population: 'deterministic-observed-cohort' as const,
  seasonalScope: 'Cumulative current-season ranked 1v1 values observed during the collection window.' as const,
  formulas: {
    pickShare: 'Observed legend games divided by all observed legend games in the selected filter.' as const,
    adoption:
      'Observed players with games on the legend divided by players with a successful ranked observation in the selected filter.' as const,
    winRate: 'Observed legend wins divided by observed legend games, weighted by games.' as const,
    medianRating: 'Median current 1v1 player rating among observed players with games on the legend.' as const,
    coverage: 'Successful ranked observations divided by selected Observed Cohort players.' as const,
    uncertainty: '95% Wilson score interval over observed legend wins and games.' as const,
  },
  eligibility: {
    minimumPlayers: 30 as const,
    minimumGames: 200 as const,
    rule: 'A row needs both minimums to receive a comparative rank.' as const,
  },
  trends: { status: 'disabled' as const, reason: 'season-identity-unavailable' as const },
  caveats: [
    'BrawlTome-observed values are not exhaustive or live.',
    'Missing source observations reduce coverage and are not counted as zero games.',
    'The source does not expose a stable season identity, so cross-publication trends are unavailable.',
    'Observed win rate describes this cohort and does not establish legend strength or causation.',
  ],
}

const fresh: AvailableLegendMeta = {
  status: 'fresh',
  staleReason: null,
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  methodologyVersion: 'current-season-legend-meta-v1',
  cohortMethodologyVersion: 'full-launch-cohort-v1',
  sourceGenerationId: '10000000-0000-4000-8000-000000000003',
  sourceObservedAt: '2026-08-10T00:00:00.000Z',
  observationWindow: { startsAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-17T00:00:00.000Z' },
  publishedAt: '2026-08-12T00:00:00.000Z',
  expectedNextPublicationAt: '2026-08-19T00:00:00.000Z',
  season: { scope: 'current-season', identity: null, source: 'brawlhalla-v1-ranked-1v1' },
  filter: { region: 'all', bracket: 'all' },
  selectedPlayers: 40,
  observedPlayers: 40,
  observedLegendGames: 200,
  coverage: { numerator: 40, denominator: 40, basisPoints: 10_000 },
  methodology,
  rows: [
    {
      legend: { legendId: 3, name: 'BÖDVAR', slug: 'bodvar' },
      rank: 1,
      eligibility: { status: 'eligible' },
      playerCount: 30,
      gameCount: 200,
      winCount: 0,
      medianRating: 1_950.5,
      pickShare: { numerator: 200, denominator: 200, basisPoints: 10_000 },
      adoption: { numerator: 30, denominator: 40, basisPoints: 7_500 },
      winRate: { numerator: 0, denominator: 200, basisPoints: 0 },
      uncertainty95: { lowerBasisPoints: 0, upperBasisPoints: 189 },
    },
    {
      legend: { legendId: 4, name: 'CASSIDY', slug: 'cassidy' },
      rank: null,
      eligibility: { status: 'insufficient-sample', minimumPlayers: 30, minimumGames: 200 },
      playerCount: 0,
      gameCount: 0,
      winCount: 0,
      medianRating: null,
      pickShare: { numerator: 0, denominator: 200, basisPoints: 0 },
      adoption: { numerator: 0, denominator: 40, basisPoints: 0 },
      winRate: { numerator: 0, denominator: 0, basisPoints: null },
      uncertainty95: null,
    },
  ],
}

function render(data: LegendMetaOutput = fresh) {
  return renderToStaticMarkup(<LegendMetaView data={data} region="all" bracket="all" onFilterChange={() => {}} />)
}

describe('Current Season Legend Meta view', () => {
  test('renders exact observed metrics, measured zero, missing values, coverage, and uncertainty honestly', () => {
    const html = render()

    expect(html).toContain('Current Season Legend Meta')
    expect(html).toContain('100.00%')
    expect(html).toContain('0.00%')
    expect(html).toContain('Unavailable')
    expect(html).toContain('1,950.5')
    expect(html).toContain('0.00%–1.89%')
    expect(html).toContain('40 of 40 selected players observed')
    expect(html).toContain('Insufficient sample')
    expect(html).toContain('Not ranked')
  })

  test('uses labeled native filters, semantic table structure, and responsive overflow', () => {
    const html = render()

    expect(html).toContain('<label for="legend-meta-region"')
    expect(html).toContain('<select id="legend-meta-region"')
    expect(html).toContain('<label for="legend-meta-bracket"')
    expect(html).toContain('<caption')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('scope="col"')
  })

  test('retains the last valid rows with an announced stale warning', () => {
    const html = render({ ...fresh, status: 'stale', staleReason: 'latest_build_failed' })

    expect(html).toContain('<output')
    expect(html).toContain('Latest build failed')
    expect(html).toContain('BÖDVAR')
  })

  test('renders unavailable as missing publication rather than measured zero', () => {
    const html = render({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: 'all', bracket: 'all' },
    })

    expect(html).toContain('No validated Legend Meta publication is available yet.')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('0.00%')
  })

  test('discloses seasonal formulas, thresholds, trend limitation, and non-causal scope', () => {
    const html = render()

    expect(html).toContain('Methodology')
    expect(html).toContain('Cumulative current-season ranked 1v1 values')
    expect(html).toContain('30 players')
    expect(html).toContain('200 games')
    expect(html).toContain('95% Wilson score interval')
    expect(html).toContain('cross-publication trends are unavailable')
    expect(html).toContain('does not establish legend strength or causation')
    expect(html).not.toContain('stronger than')
    expect(html).not.toContain('best legend')
  })
})
