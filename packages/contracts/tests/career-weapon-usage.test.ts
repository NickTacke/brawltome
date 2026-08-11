import { describe, expect, test } from 'bun:test'
import {
  careerWeaponUsageInputSchema,
  careerWeaponUsageOutputSchema,
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
