import { describe, expect, test } from 'bun:test'
import type { CareerWeaponUsageOutputContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { CareerWeaponUsage, CareerWeaponUsageLoadError } from '../../../src/components/statistics/CareerWeaponUsage'
import { parseCareerWeaponUsageFilters } from '../../../src/components/statistics/filters'

const fresh = {
  status: 'fresh',
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  cohortMethodologyVersion: 'full-launch-cohort-v1',
  methodologyVersion: 'career-weapon-usage-v1',
  observationWindow: { startsAt: '2026-08-10T00:00:00Z', endsAt: '2026-08-17T00:00:00Z' },
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
} satisfies CareerWeaponUsageOutputContract

describe('Career Weapon Usage page content', () => {
  test('states the career/current-bracket scope and renders accessible filters with every required metric', () => {
    const html = renderToStaticMarkup(<CareerWeaponUsage view={fresh} />)

    expect(html).toContain('Career observations from players currently in the selected bracket')
    expect(html).toContain('do not describe current-season performance or weapon strength')
    expect(html).toContain('<label for="career-region"')
    expect(html).toContain('id="career-region"')
    expect(html).toContain('name="region"')
    expect(html).toContain('<label for="career-bracket"')
    expect(html).toContain('id="career-bracket"')
    expect(html).toContain('name="bracket"')
    for (const heading of [
      'Prevalence',
      'Held-time share',
      'Median damage / held minute',
      'Median KOs / held hour',
      'Contributors',
      'Coverage',
    ]) {
      expect(html).toContain(heading)
    }
    expect(html).toContain('aria-describedby="career-methodology"')
    expect(html).toContain('dateTime="2026-08-10T00:00:00Z"')
    expect(html).toContain('dateTime="2026-08-17T00:00:01Z"')
    expect(html).toContain('Career metric methodology: career-weapon-usage-v1')
    expect(html).toContain('Cohort methodology: full-launch-cohort-v1')
  })

  test('distinguishes measured zero, unavailable rates, and insufficient comparison evidence', () => {
    const html = renderToStaticMarkup(<CareerWeaponUsage view={fresh} />)

    expect(html).toContain('>0.00<')
    expect(html).toContain('Unavailable')
    expect(html).toContain('Insufficient data')
    expect(html).toContain('0 of 119 observed players')
    expect(html).toContain('119 of 125 selected players observed (95.2% coverage)')
  })

  test('retains rows with an explicit stale warning and renders first-publication absence without zeros', () => {
    const stale: CareerWeaponUsageOutputContract = {
      ...fresh,
      status: 'stale',
      staleReasons: ['newer_publication_rejected', 'weekly_publication_overdue'],
    }
    const staleHtml = renderToStaticMarkup(<CareerWeaponUsage view={stale} />)
    expect(staleHtml).toContain('Update delayed')
    expect(staleHtml).toContain('Showing the last valid career observations')
    expect(staleHtml).toContain('Hammer')

    const unavailableHtml = renderToStaticMarkup(
      <CareerWeaponUsage
        view={{
          status: 'unavailable',
          reason: 'not_yet_published',
          filters: { region: 'all', bracket: 'all' },
        }}
      />,
    )
    expect(unavailableHtml).toContain('Career Weapon Usage is not yet available')
    expect(unavailableHtml).not.toContain('0 players')
    expect(unavailableHtml).not.toContain('<table')
  })

  test('distinguishes transport failure from an unpublished snapshot', () => {
    const html = renderToStaticMarkup(<CareerWeaponUsageLoadError filters={{ region: 'EU', bracket: 'Diamond+' }} />)

    expect(html).toContain('role="alert"')
    expect(html).toContain('Unable to load Career Weapon Usage')
    expect(html).toContain('Existing observations are not being shown as zero')
    expect(html).not.toContain('not yet available')
  })

  test('discloses fixed formulas and eligibility rather than ranking insufficient rows', () => {
    const html = renderToStaticMarkup(<CareerWeaponUsage view={fresh} />)

    expect(html).toContain('positive weapon-held time')
    expect(html).toContain('at least 30 held minutes per player and weapon')
    expect(html).toContain('30 qualifying contributors and 30 aggregate observed held hours')
    expect(html).toContain('median of per-player rates')
    expect(html.toLowerCase()).not.toContain('win rate')
    expect(html.toLowerCase()).not.toContain('tier list')
  })
})

describe('Career Weapon Usage URL filters', () => {
  test('accepts only supported current cohort scopes and falls back honestly', () => {
    expect(parseCareerWeaponUsageFilters({ region: 'EU', bracket: 'Diamond+' })).toEqual({
      region: 'EU',
      bracket: 'Diamond+',
    })
    expect(parseCareerWeaponUsageFilters({ region: 'historical', bracket: 'Gold' })).toEqual({
      region: 'all',
      bracket: 'all',
    })
    expect(parseCareerWeaponUsageFilters({ region: ['EU'], bracket: ['Diamond+'] })).toEqual({
      region: 'all',
      bracket: 'all',
    })
  })
})
