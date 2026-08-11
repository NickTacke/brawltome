import { describe, expect, test } from 'bun:test'
import type { CareerWeaponUsageQueries, CareerWeaponUsageView } from '@brawltome/statistics'
import { statisticsRouter } from '../src/router/statistics.router'
import type { Context } from '../src/trpc/context'

function callerFor(getCareerWeaponUsage: CareerWeaponUsageQueries['getCareerWeaponUsage']) {
  const statisticsQueries: CareerWeaponUsageQueries = { getCareerWeaponUsage }
  return statisticsRouter.createCaller({
    statisticsQueries,
    playerRepo: new Proxy(
      {},
      {
        get() {
          throw new Error('Career Weapon Usage must not read mutable Players state')
        },
      },
    ),
  } as unknown as Context)
}

const available: CareerWeaponUsageView = {
  status: 'fresh',
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  cohortMethodologyVersion: 'full-launch-cohort-v1',
  methodologyVersion: 'career-weapon-usage-v1',
  observationWindow: { startsAt: '2026-08-10T00:00:00Z', endsAt: '2026-08-17T00:00:00Z' },
  publishedAt: '2026-08-17T00:00:01Z',
  expectedNextPublicationAt: '2026-08-24T00:00:00Z',
  filters: { region: 'EU', bracket: 'Diamond+' },
  staleReasons: [],
  selectedPlayers: 125,
  successfulObservations: 119,
  coverage: { numerator: '119', denominator: '125' },
  totalHeldSeconds: '108000',
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
  ],
  latestDecision: {
    decisionId: '10000000-0000-4000-8000-000000000003',
    generationId: '10000000-0000-4000-8000-000000000002',
    effectOperationId: '10000000-0000-4000-8000-000000000004',
    operationKey: 'statistics:generation:publication:lifetime',
    outcome: 'accepted',
    reasons: [],
    progress: {
      product: 'lifetime',
      selectedPlayers: 125,
      operations: 125,
      sourceAttempts: 125,
      successes: 119,
      overallCoverageBasisPoints: 9520,
      cells: [],
    },
    observationWindow: { startsAt: '2026-08-10T00:00:00Z', endsAt: '2026-08-17T00:00:00Z' },
    capacityEnvelope: {
      sourceDomain: 'brawlhalla-v1',
      quotaUnitsPerWindow: 150,
      quotaWindowSeconds: 900,
      requestsPerPlayer: 2,
      maxAttemptsPerRequest: 3,
      plannedRequests: 250,
      maximumSourceAttempts: 750,
      minimumCapacitySeconds: 4500,
      observationWindowSeconds: 604800,
    },
    decidedAt: '2026-08-17T00:00:01Z',
  },
}

describe('statistics.careerWeaponUsage', () => {
  test('forwards current cohort filters through Statistics and maps the canonical output', async () => {
    const calls: unknown[] = []
    const caller = callerFor(async (filters) => {
      calls.push(filters)
      return available
    })

    await expect(caller.careerWeaponUsage({ region: 'EU', bracket: 'Diamond+' })).resolves.toMatchObject({
      status: 'fresh',
      filters: { region: 'EU', bracket: 'Diamond+' },
      staleReasons: [],
      rows: [{ weapon: 'Hammer', medianDamagePerMinute: { numerator: '0', denominator: '1' } }],
    })
    expect(calls).toEqual([{ region: 'EU', bracket: 'Diamond+' }])
    await expect(caller.careerWeaponUsage({ region: 'EU', bracket: 'Gold' } as never)).rejects.toThrow()
  })

  test('maps unavailable and stale semantics without exposing internal publication evidence', async () => {
    const unavailable = callerFor(async (filters) => ({
      status: 'unavailable',
      reason: 'not-yet-published',
      filters,
    }))
    await expect(unavailable.careerWeaponUsage({ region: 'all', bracket: 'all' })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filters: { region: 'all', bracket: 'all' },
    })

    const stale = callerFor(async () => ({
      ...available,
      status: 'stale',
      staleReasons: ['newer-publication-rejected', 'weekly-publication-overdue'],
    }))
    const result = await stale.careerWeaponUsage({ region: 'EU', bracket: 'Diamond+' })
    expect(result).toMatchObject({
      status: 'stale',
      staleReasons: ['newer_publication_rejected', 'weekly_publication_overdue'],
    })
    expect(result).not.toHaveProperty('latestDecision')
  })

  test('rejects malformed producer output', async () => {
    const malformed = callerFor(
      async () =>
        ({
          ...available,
          rows: [{ ...available.rows[0], medianDamagePerMinute: { numerator: '0', denominator: '0' } }],
        }) as CareerWeaponUsageView,
    )

    await expect(malformed.careerWeaponUsage({ region: 'EU', bracket: 'Diamond+' })).rejects.toThrow()
  })
})
