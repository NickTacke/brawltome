import { describe, expect, test } from 'bun:test'
import {
  careerWeaponUsageHistoryOutputSchema,
  careerWeaponUsageInputSchema,
  careerWeaponUsageOutputSchema,
  parseCareerWeaponUsageHistoryOutput,
  parseCareerWeaponUsageOutput,
} from '../src/career-weapon-usage'

const available = {
  status: 'fresh',
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  cohortMethodologyVersion: 'full-launch-cohort-v1',
  methodologyVersion: 'career-weapon-usage-v1',
  observationWindow: {
    startsAt: '2026-08-10T00:00:00Z',
    endsAt: '2026-08-17T00:00:00Z',
  },
  publishedAt: '2026-08-17T00:00:01Z',
  expectedNextPublicationAt: '2026-08-24T00:00:00Z',
  filters: { region: 'EU', bracket: 'Diamond+' },
  selectedPlayers: 125,
  successfulObservations: 119,
  coverage: { numerator: '119', denominator: '125' },
  totalHeldSeconds: '108000',
  staleReasons: [],
  rows: [
    {
      weapon: 'Hammer',
      observedPlayers: 119,
      prevalence: { numerator: '1', denominator: '1' },
      heldTimeSeconds: '108000',
      heldTimeShare: { numerator: '1', denominator: '1' },
      contributorCount: 30,
      qualifyingHeldSeconds: '108000',
      medianDamagePerMinute: { numerator: '0', denominator: '1' },
      medianKosPerHour: { numerator: '0', denominator: '1' },
      comparison: { eligible: true, reasons: [] },
    },
    {
      weapon: 'Sword',
      observedPlayers: 0,
      prevalence: { numerator: '0', denominator: '1' },
      heldTimeSeconds: '0',
      heldTimeShare: { numerator: '0', denominator: '1' },
      contributorCount: 0,
      qualifyingHeldSeconds: '0',
      medianDamagePerMinute: null,
      medianKosPerHour: null,
      comparison: {
        eligible: false,
        reasons: ['contributors-below-30', 'aggregate-held-time-below-30-hours'],
      },
    },
  ],
} as const

const historySnapshot = {
  snapshotId: available.snapshotId,
  generationId: available.generationId,
  cohortMethodologyVersion: available.cohortMethodologyVersion,
  methodologyVersion: available.methodologyVersion,
  observationWindow: available.observationWindow,
  publishedAt: available.publishedAt,
  scope: available.filters,
  selectedPlayers: available.selectedPlayers,
  successfulObservations: available.successfulObservations,
  coverage: available.coverage,
  totalHeldSeconds: available.totalHeldSeconds,
  rows: available.rows,
}

const previousHistorySnapshot = {
  ...historySnapshot,
  snapshotId: '10000000-0000-4000-8000-000000000011',
  generationId: '10000000-0000-4000-8000-000000000012',
  publishedAt: '2026-08-10T00:00:01Z',
  rows: historySnapshot.rows.map((row, index) =>
    index === 0
      ? {
          ...row,
          medianDamagePerMinute: { numerator: '1', denominator: '2' },
          medianKosPerHour: { numerator: '1', denominator: '1' },
        }
      : row,
  ),
}

describe('Career Weapon Usage contract', () => {
  test('accepts exact metrics while preserving measured zero and unavailable rates', () => {
    const parsed = parseCareerWeaponUsageOutput(available)
    if (parsed.status === 'unavailable') throw new Error('expected an available Career snapshot')

    expect(parsed).toMatchObject({
      cohortMethodologyVersion: 'full-launch-cohort-v1',
      methodologyVersion: 'career-weapon-usage-v1',
    })
    expect(parsed.rows[0]).toMatchObject({
      medianDamagePerMinute: { numerator: '0', denominator: '1' },
      medianKosPerHour: { numerator: '0', denominator: '1' },
    })
    expect(parsed.rows[1]).toMatchObject({
      observedPlayers: 0,
      prevalence: { numerator: '0', denominator: '1' },
      medianDamagePerMinute: null,
      medianKosPerHour: null,
      comparison: { eligible: false },
    })
  })

  test('allows only current cohort scopes and a narrow unavailable state', () => {
    expect(careerWeaponUsageInputSchema.parse({ region: 'all', bracket: 'all' })).toEqual({
      region: 'all',
      bracket: 'all',
    })
    expect(() => careerWeaponUsageInputSchema.parse({ region: 'EU', bracket: 'Gold' })).toThrow()
    expect(() => careerWeaponUsageInputSchema.parse({ region: 'historical', bracket: 'Diamond+' })).toThrow()
    expect(
      careerWeaponUsageOutputSchema.parse({
        status: 'unavailable',
        reason: 'not_yet_published',
        filters: { region: 'all', bracket: 'all' },
      }),
    ).toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filters: { region: 'all', bracket: 'all' },
    })
  })

  test('requires honest stale reasons and internally consistent eligibility', () => {
    expect(
      parseCareerWeaponUsageOutput({
        ...available,
        status: 'stale',
        staleReasons: ['newer_publication_rejected', 'weekly_publication_overdue'],
      }).status,
    ).toBe('stale')
    expect(() => parseCareerWeaponUsageOutput({ ...available, status: 'stale', staleReasons: [] })).toThrow()
    expect(() =>
      parseCareerWeaponUsageOutput({
        ...available,
        rows: [{ ...available.rows[1], comparison: { eligible: true, reasons: [] } }],
      }),
    ).toThrow()
    expect(() =>
      parseCareerWeaponUsageOutput({
        ...available,
        rows: [{ ...available.rows[0], medianDamagePerMinute: null }],
      }),
    ).toThrow()
  })

  test('rejects floats, negative counts, malformed ratios, unknown fields, and non-UTC timestamps', () => {
    for (const malformed of [
      { ...available, selectedPlayers: 1.5 },
      { ...available, successfulObservations: -1 },
      { ...available, coverage: { numerator: '119', denominator: '0' } },
      { ...available, extra: true },
      { ...available, publishedAt: '2026-08-17T01:00:01+01:00' },
      { ...available, methodologyVersion: available.cohortMethodologyVersion },
    ]) {
      expect(() => parseCareerWeaponUsageOutput(malformed)).toThrow()
    }
  })
})

describe('Career Weapon Usage history contract', () => {
  test('accepts exact adjacent Career deltas without applying a season gate', () => {
    const delta = {
      weapon: 'Hammer',
      prevalence: { changeBasisPoints: 0, direction: 'unchanged' },
      heldTimeShare: { changeBasisPoints: 0, direction: 'unchanged' },
      medianDamagePerMinute: {
        change: { numerator: '-1', denominator: '2' },
        direction: 'decrease',
      },
      medianKosPerHour: {
        change: { numerator: '-1', denominator: '1' },
        direction: 'decrease',
      },
    } as const
    const output = {
      status: 'available',
      filters: available.filters,
      entries: [
        {
          snapshot: historySnapshot,
          comparisonToPrevious: {
            status: 'available',
            previousSnapshotId: previousHistorySnapshot.snapshotId,
            deltas: [delta],
          },
        },
        { snapshot: previousHistorySnapshot, comparisonToPrevious: null },
      ],
    } as const

    expect(parseCareerWeaponUsageHistoryOutput(output)).toEqual(JSON.parse(JSON.stringify(output)))
    for (const malformedFirstEntry of [
      {
        ...output.entries[0],
        comparisonToPrevious: { ...output.entries[0].comparisonToPrevious, deltas: [] },
      },
      {
        ...output.entries[0],
        comparisonToPrevious: { ...output.entries[0].comparisonToPrevious, deltas: [delta, delta] },
      },
      {
        ...output.entries[0],
        snapshot: {
          ...output.entries[0].snapshot,
          coverage: { numerator: '118', denominator: '125' },
        },
      },
    ]) {
      expect(() =>
        parseCareerWeaponUsageHistoryOutput({
          ...output,
          entries: [malformedFirstEntry, output.entries[1]],
        }),
      ).toThrow()
    }
  })

  test('rejects deltas for stored-ineligible rows and incompatible edges', () => {
    const insufficientDelta = {
      weapon: 'Sword',
      prevalence: { changeBasisPoints: 0, direction: 'unchanged' },
      heldTimeShare: { changeBasisPoints: 0, direction: 'unchanged' },
      medianDamagePerMinute: { change: { numerator: '0', denominator: '1' }, direction: 'unchanged' },
      medianKosPerHour: { change: { numerator: '0', denominator: '1' }, direction: 'unchanged' },
    } as const
    const incompatiblePrevious = {
      ...previousHistorySnapshot,
      cohortMethodologyVersion: 'full-launch-cohort-v2',
    }
    const base = {
      status: 'available',
      filters: available.filters,
      entries: [
        {
          snapshot: historySnapshot,
          comparisonToPrevious: {
            status: 'available',
            previousSnapshotId: previousHistorySnapshot.snapshotId,
            deltas: [insufficientDelta],
          },
        },
        { snapshot: previousHistorySnapshot, comparisonToPrevious: null },
      ],
    } as const

    expect(() => parseCareerWeaponUsageHistoryOutput(base)).toThrow()
    expect(() =>
      parseCareerWeaponUsageHistoryOutput({
        ...base,
        entries: [base.entries[0], { snapshot: incompatiblePrevious, comparisonToPrevious: null }],
      }),
    ).toThrow()
  })

  test('requires stable break reasons, maximum depth, and explicit unavailability', () => {
    const incompatiblePrevious = {
      ...previousHistorySnapshot,
      methodologyVersion: 'career-weapon-usage-v2',
    }
    expect(
      parseCareerWeaponUsageHistoryOutput({
        status: 'available',
        filters: available.filters,
        entries: [
          {
            snapshot: historySnapshot,
            comparisonToPrevious: {
              status: 'incompatible',
              previousSnapshotId: incompatiblePrevious.snapshotId,
              reasons: [
                {
                  code: 'metric_methodology_mismatch',
                  explanation: 'The product metric methodology changed between adjacent snapshots.',
                },
              ],
            },
          },
          { snapshot: incompatiblePrevious, comparisonToPrevious: null },
        ],
      }).status,
    ).toBe('available')
    expect(() =>
      careerWeaponUsageHistoryOutputSchema.parse({
        status: 'available',
        filters: available.filters,
        entries: Array.from({ length: 9 }, (_, index) => ({
          snapshot: {
            ...historySnapshot,
            snapshotId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          },
          comparisonToPrevious: null,
        })),
      }),
    ).toThrow()
    expect(
      parseCareerWeaponUsageHistoryOutput({
        status: 'unavailable',
        reason: 'not_yet_published',
        filters: { region: 'all', bracket: 'all' },
      }).status,
    ).toBe('unavailable')
  })
})
