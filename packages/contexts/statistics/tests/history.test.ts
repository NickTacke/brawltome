import { describe, expect, test } from 'bun:test'
import {
  type CareerWeaponHistorySnapshot,
  type LegendMetaHistorySnapshot,
  buildCareerWeaponUsageHistory,
  buildLegendMetaHistory,
  classifyAdjacentSnapshots,
} from '../history'

const scope = { region: 'EU', bracket: 'Diamond+' }

function compatibility(
  overrides: Partial<LegendMetaHistorySnapshot['compatibility']> = {},
): LegendMetaHistorySnapshot['compatibility'] {
  return {
    season: { applicability: 'required', identity: 'season-38' },
    cohortMethodologyVersion: 'full-launch-cohort-v1',
    metricMethodologyVersion: 'current-season-legend-meta-v1',
    scope,
    ...overrides,
  }
}

function legendSnapshot(
  snapshotId: string,
  publishedAt: string,
  overrides: Partial<LegendMetaHistorySnapshot> = {},
): LegendMetaHistorySnapshot {
  return {
    snapshotId,
    publishedAt,
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    compatibility: compatibility(),
    rows: [
      {
        legend: { legendId: 3, name: 'Bödvar', slug: 'bodvar' },
        eligible: true,
        rank: 2,
        medianRating: 2_000,
        pickShareBasisPoints: 4_000,
        adoptionBasisPoints: 5_000,
        winRateBasisPoints: 5_200,
      },
    ],
    ...overrides,
  }
}

function careerSnapshot(
  snapshotId: string,
  publishedAt: string,
  overrides: Partial<CareerWeaponHistorySnapshot> = {},
): CareerWeaponHistorySnapshot {
  return {
    snapshotId,
    publishedAt,
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    compatibility: {
      season: { applicability: 'not-applicable' },
      cohortMethodologyVersion: 'full-launch-cohort-v1',
      metricMethodologyVersion: 'career-weapon-usage-v1',
      scope,
    },
    rows: [
      {
        weapon: 'Hammer',
        eligible: true,
        prevalence: { numerator: '1', denominator: '2' },
        heldTimeShare: { numerator: '2', denominator: '5' },
        medianDamagePerMinute: { numerator: '3', denominator: '2' },
        medianKosPerHour: { numerator: '2', denominator: '1' },
      },
    ],
    ...overrides,
  }
}

describe('adjacent statistics snapshot compatibility', () => {
  test('requires the same non-null authoritative Legend season identity', () => {
    expect(
      classifyAdjacentSnapshots(
        compatibility({ season: { applicability: 'required', identity: null } }),
        compatibility(),
      ),
    ).toEqual({
      status: 'incompatible',
      reasons: [
        {
          code: 'season_identity_unavailable',
          explanation: 'Adjacent Legend snapshots need the same non-null authoritative season identity.',
        },
      ],
    })
    expect(
      classifyAdjacentSnapshots(
        compatibility({ season: { applicability: 'required', identity: null } }),
        compatibility({ season: { applicability: 'required', identity: null } }),
      ),
    ).toMatchObject({ status: 'incompatible', reasons: [{ code: 'season_identity_unavailable' }] })
    expect(
      classifyAdjacentSnapshots(
        compatibility({ season: { applicability: 'required', identity: 'season-39' } }),
        compatibility(),
      ),
    ).toMatchObject({ status: 'incompatible', reasons: [{ code: 'season_mismatch' }] })
    expect(classifyAdjacentSnapshots(compatibility(), compatibility())).toEqual({ status: 'compatible' })
  })

  test('treats Career season as not applicable and reports every other break in stable order', () => {
    const career = careerSnapshot('career-new', '2026-08-15T00:00:00.000Z').compatibility
    expect(classifyAdjacentSnapshots(career, career)).toEqual({ status: 'compatible' })

    expect(
      classifyAdjacentSnapshots(
        compatibility({
          season: { applicability: 'required', identity: 'season-39' },
          cohortMethodologyVersion: 'full-launch-cohort-v2',
          metricMethodologyVersion: 'current-season-legend-meta-v2',
          scope: { region: 'all', bracket: 'Platinum' },
        }),
        compatibility(),
      ),
    ).toEqual({
      status: 'incompatible',
      reasons: [
        {
          code: 'season_mismatch',
          explanation: 'The authoritative season identity changed between adjacent snapshots.',
        },
        {
          code: 'cohort_methodology_mismatch',
          explanation: 'The cohort methodology changed between adjacent snapshots.',
        },
        {
          code: 'metric_methodology_mismatch',
          explanation: 'The product metric methodology changed between adjacent snapshots.',
        },
        {
          code: 'scope_mismatch',
          explanation: 'The region or bracket scope changed between adjacent snapshots.',
        },
      ],
    })
  })
})

describe('product-specific adjacent deltas', () => {
  test('reproduces exact Legend non-rank metric and arithmetic direction changes', () => {
    const older = legendSnapshot('legend-old', '2026-08-08T00:00:00.000Z')
    const newer = legendSnapshot('legend-new', '2026-08-15T00:00:00.000Z', {
      rows: [
        {
          legend: { legendId: 3, name: 'Bödvar', slug: 'bodvar' },
          eligible: true,
          rank: 1,
          medianRating: 1_999.5,
          pickShareBasisPoints: 4_125,
          adoptionBasisPoints: 5_000,
          winRateBasisPoints: 5_150,
        },
      ],
    })

    expect(buildLegendMetaHistory([older, newer])).toEqual([
      {
        snapshot: newer,
        comparisonToPrevious: {
          status: 'available',
          previousSnapshotId: 'legend-old',
          deltas: [
            {
              legend: newer.rows[0]?.legend,
              pickShare: { changeBasisPoints: 125, direction: 'increase' },
              adoption: { changeBasisPoints: 0, direction: 'unchanged' },
              winRate: { changeBasisPoints: -50, direction: 'decrease' },
              medianRating: { change: -0.5, direction: 'decrease' },
            },
          ],
        },
      },
      { snapshot: older, comparisonToPrevious: null },
    ])
  })

  test('reproduces Career basis-point and normalized signed exact-rational changes', () => {
    const older = careerSnapshot('career-old', '2026-08-08T00:00:00.000Z')
    const newer = careerSnapshot('career-new', '2026-08-15T00:00:00.000Z', {
      rows: [
        {
          weapon: 'Hammer',
          eligible: true,
          prevalence: { numerator: '51', denominator: '100' },
          heldTimeShare: { numerator: '39', denominator: '100' },
          medianDamagePerMinute: { numerator: '7', denominator: '4' },
          medianKosPerHour: { numerator: '3', denominator: '2' },
        },
      ],
    })

    expect(buildCareerWeaponUsageHistory([newer, older])[0]?.comparisonToPrevious).toEqual({
      status: 'available',
      previousSnapshotId: 'career-old',
      deltas: [
        {
          weapon: 'Hammer',
          prevalence: { changeBasisPoints: 100, direction: 'increase' },
          heldTimeShare: { changeBasisPoints: -100, direction: 'decrease' },
          medianDamagePerMinute: {
            change: { numerator: '1', denominator: '4' },
            direction: 'increase',
          },
          medianKosPerHour: {
            change: { numerator: '-1', denominator: '2' },
            direction: 'decrease',
          },
        },
      ],
    })
  })

  test('never gives missing or stored-ineligible rows metric deltas or directions', () => {
    const eligibleLegend = legendSnapshot('legend-new', '2026-08-15T00:00:00.000Z')
    const fixtureRow = legendSnapshot('fixture', '2026-08-01T00:00:00.000Z').rows[0]
    if (!fixtureRow) throw new Error('Legend history fixture row missing')
    const insufficientLegend = legendSnapshot('legend-old', '2026-08-08T00:00:00.000Z', {
      rows: [{ ...fixtureRow, eligible: false, rank: null }],
    })
    expect(buildLegendMetaHistory([eligibleLegend, insufficientLegend])[0]?.comparisonToPrevious).toEqual({
      status: 'available',
      previousSnapshotId: 'legend-old',
      deltas: [],
    })

    const missingCareer = careerSnapshot('career-old', '2026-08-08T00:00:00.000Z', { rows: [] })
    expect(
      buildCareerWeaponUsageHistory([careerSnapshot('career-new', '2026-08-15T00:00:00.000Z'), missingCareer])[0]
        ?.comparisonToPrevious,
    ).toEqual({
      status: 'available',
      previousSnapshotId: 'career-old',
      deltas: [],
    })
  })
})

describe('compatible history traversal', () => {
  test('sorts deterministically, caps at eight snapshots, and never scans past the first break', () => {
    const newest = legendSnapshot('legend-10', '2026-10-10T00:00:00.000Z')
    const breakPoint = legendSnapshot('legend-09', '2026-10-09T00:00:00.000Z', {
      compatibility: compatibility({ cohortMethodologyVersion: 'full-launch-cohort-v0' }),
    })
    const shouldNotAppear = legendSnapshot('legend-08', '2026-10-08T00:00:00.000Z', {
      compatibility: breakPoint.compatibility,
    })

    const broken = buildLegendMetaHistory([shouldNotAppear, breakPoint, newest])
    expect(broken.map(({ snapshot }) => snapshot.snapshotId)).toEqual(['legend-10', 'legend-09'])
    expect(broken[0]?.comparisonToPrevious).toMatchObject({
      status: 'incompatible',
      previousSnapshotId: 'legend-09',
      reasons: [{ code: 'cohort_methodology_mismatch' }],
    })
    expect(broken[1]?.comparisonToPrevious).toBeNull()

    const compatible = Array.from({ length: 10 }, (_, index) =>
      legendSnapshot(
        `legend-${String(index).padStart(2, '0')}`,
        `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      ),
    )
    const frozenInput = Object.freeze([...compatible])
    expect(buildLegendMetaHistory(frozenInput)).toHaveLength(8)
    expect(buildLegendMetaHistory(frozenInput)[0]?.snapshot.snapshotId).toBe('legend-09')
    expect(frozenInput.map(({ snapshotId }) => snapshotId)).toEqual(compatible.map(({ snapshotId }) => snapshotId))

    const delayedOlderGeneration = legendSnapshot('legend-delayed', '2026-10-11T00:00:00.000Z', {
      sequence: { at: '2026-10-01T00:00:00.000Z', id: 'generation-old' },
    })
    const currentGeneration = legendSnapshot('legend-current', '2026-10-10T00:00:00.000Z', {
      sequence: { at: '2026-10-02T00:00:00.000Z', id: 'generation-new' },
    })
    expect(buildLegendMetaHistory([delayedOlderGeneration, currentGeneration])[0]?.snapshot.snapshotId).toBe(
      'legend-current',
    )
  })
})
