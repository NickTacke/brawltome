import { describe, expect, test } from 'bun:test'
import { parseCareerWeaponUsageHistoryOutput, parseLegendMetaHistoryOutput } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { CareerWeaponUsageHistory } from '../../../src/components/statistics/CareerWeaponUsageHistory'
import { LegendMetaHistory } from '../../../src/components/statistics/LegendMetaHistory'

const legendRow = {
  legend: { legendId: 3, name: 'Bödvar', slug: 'bodvar' },
  rank: 1,
  eligibility: { status: 'eligible' as const },
  playerCount: 30,
  gameCount: 200,
  winCount: 100,
  medianRating: 2_000,
  pickShare: { numerator: 200, denominator: 200, basisPoints: 10_000 },
  adoption: { numerator: 30, denominator: 30, basisPoints: 10_000 },
  winRate: { numerator: 100, denominator: 200, basisPoints: 5_000 },
  uncertainty95: { lowerBasisPoints: 4_313, upperBasisPoints: 5_687 },
}

function legendSnapshot(snapshotId: string, generationId: string, publishedAt: string) {
  return {
    snapshotId,
    generationId,
    methodologyVersion: 'current-season-legend-meta-v1',
    cohortMethodologyVersion: 'full-launch-cohort-v1',
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    publishedAt,
    season: { scope: 'current-season', identity: null, source: 'brawlhalla-v1-ranked-1v1' },
    scope: { region: 'all', bracket: 'all' },
    selectedPlayers: 30,
    observedPlayers: 30,
    observedLegendGames: 200,
    coverage: { numerator: 30, denominator: 30, basisPoints: 10_000 },
    rows: [legendRow],
  } as const
}

const newerLegend = legendSnapshot(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '2026-08-15T00:00:00.000Z',
)
const olderLegend = legendSnapshot(
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000012',
  '2026-08-08T00:00:00.000Z',
)
const legendHistory = parseLegendMetaHistoryOutput({
  status: 'available',
  filter: { region: 'all', bracket: 'all' },
  entries: [
    {
      snapshot: newerLegend,
      comparisonToPrevious: {
        status: 'incompatible',
        previousSnapshotId: olderLegend.snapshotId,
        reasons: [
          {
            code: 'season_identity_unavailable',
            explanation: 'Adjacent Legend snapshots need the same non-null authoritative season identity.',
          },
        ],
      },
    },
    { snapshot: olderLegend, comparisonToPrevious: null },
  ],
})

const compatibleNewerLegend = {
  ...newerLegend,
  season: { ...newerLegend.season, identity: 'season-38' },
}
const compatibleOlderLegend = {
  ...olderLegend,
  season: compatibleNewerLegend.season,
  rows: [{ ...legendRow, rank: 2, medianRating: 1_999.5 }],
}
const compatibleLegendHistory = parseLegendMetaHistoryOutput({
  status: 'available',
  filter: { region: 'all', bracket: 'all' },
  entries: [
    {
      snapshot: compatibleNewerLegend,
      comparisonToPrevious: {
        status: 'available',
        previousSnapshotId: compatibleOlderLegend.snapshotId,
        deltas: [
          {
            legend: legendRow.legend,
            pickShare: { changeBasisPoints: 0, direction: 'unchanged' },
            adoption: { changeBasisPoints: 0, direction: 'unchanged' },
            winRate: { changeBasisPoints: 0, direction: 'unchanged' },
            medianRating: { change: 0.5, direction: 'increase' },
          },
        ],
      },
    },
    { snapshot: compatibleOlderLegend, comparisonToPrevious: null },
  ],
})

const careerRow = {
  weapon: 'Hammer',
  observedPlayers: 30,
  prevalence: { numerator: '1', denominator: '1' },
  heldTimeSeconds: '108000',
  heldTimeShare: { numerator: '1', denominator: '1' },
  contributorCount: 30,
  qualifyingHeldSeconds: '108000',
  medianKosPerHour: { numerator: '1', denominator: '1' },
  comparison: { eligible: true as const, reasons: [] as [] },
}

function careerSnapshot(snapshotId: string, generationId: string, publishedAt: string, damageNumerator: string) {
  return {
    snapshotId,
    generationId,
    methodologyVersion: 'career-weapon-usage-v1',
    cohortMethodologyVersion: 'full-launch-cohort-v1',
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    publishedAt,
    scope: { region: 'all', bracket: 'all' },
    selectedPlayers: 30,
    successfulObservations: 30,
    coverage: { numerator: '1', denominator: '1' },
    totalHeldSeconds: '108000',
    rows: [{ ...careerRow, medianDamagePerMinute: { numerator: damageNumerator, denominator: '1' } }],
  }
}

const newerCareerBase = careerSnapshot(
  '10000000-0000-4000-8000-000000000021',
  '10000000-0000-4000-8000-000000000022',
  '2026-08-15T00:00:00.000Z',
  '2',
)
const newerCareer = {
  ...newerCareerBase,
  rows: [{ ...newerCareerBase.rows[0], medianDamagePerMinute: { numerator: '4', denominator: '3' } }],
}
const olderCareer = careerSnapshot(
  '10000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000032',
  '2026-08-08T00:00:00.000Z',
  '1',
)
const careerHistory = parseCareerWeaponUsageHistoryOutput({
  status: 'available',
  filters: { region: 'all', bracket: 'all' },
  entries: [
    {
      snapshot: newerCareer,
      comparisonToPrevious: {
        status: 'available',
        previousSnapshotId: olderCareer.snapshotId,
        deltas: [
          {
            weapon: 'Hammer',
            prevalence: { changeBasisPoints: 0, direction: 'unchanged' },
            heldTimeShare: { changeBasisPoints: 0, direction: 'unchanged' },
            medianDamagePerMinute: {
              change: { numerator: '1', denominator: '3' },
              direction: 'increase',
            },
            medianKosPerHour: {
              change: { numerator: '0', denominator: '1' },
              direction: 'unchanged',
            },
          },
        ],
      },
    },
    { snapshot: olderCareer, comparisonToPrevious: null },
  ],
})

describe('statistics history sections', () => {
  test('shows Legend snapshots and the explicit season break without invented direction language', () => {
    const html = renderToStaticMarkup(<LegendMetaHistory history={legendHistory} />)

    expect(html).toContain('Snapshot history')
    expect(html).toContain('2 validated snapshots')
    expect(html).toContain('Adjacent Legend snapshots need the same non-null authoritative season identity.')
    expect(html).not.toContain('increased')
    expect(html).not.toContain('decreased')
    expect(html).not.toContain('rank movement')
  })

  test('shows only exact Legend non-rank changes while retaining snapshot counts and coverage', () => {
    const html = renderToStaticMarkup(<LegendMetaHistory history={compatibleLegendHistory} />)

    expect(html).toContain('Bödvar')
    expect(html).toContain('0 bp (unchanged)')
    expect(html).toContain('+0.5 (increase)')
    expect(html).toContain('30 of 30 selected players observed')
    expect(html).toContain('Counts and coverage are snapshot values, not changes.')
    expect(html).not.toContain('Rank movement')
    expect(html).not.toContain('improved')
    expect(html).not.toContain('declined')
  })

  test('shows exact Career changes only for rows eligible in both adjacent snapshots', () => {
    const html = renderToStaticMarkup(<CareerWeaponUsageHistory history={careerHistory} />)

    expect(html).toContain('Snapshot history')
    expect(html).toContain('Hammer')
    expect(html).toContain('+0.33 (increase; exact +1/3)')
    expect(html).toContain('0 bp (unchanged)')
    expect(html).toContain('30 of 30 selected players observed')
    expect(html).toContain('lifetime weapon observations')
    expect(html).toContain('current 1v1 bracket filter')
    expect(html).toContain('Counts and coverage are snapshot values, not changes.')
    expect(html).not.toContain('season')
  })

  test('announces an independent history failure without replacing current product content', () => {
    const legendHtml = renderToStaticMarkup(<LegendMetaHistory error="History request failed" />)
    const careerHtml = renderToStaticMarkup(<CareerWeaponUsageHistory error="History request failed" />)

    expect(legendHtml).toContain('Legend history unavailable')
    expect(legendHtml).toContain('History request failed')
    expect(careerHtml).toContain('Career history unavailable')
    expect(careerHtml).toContain('History request failed')
  })
})
