import { describe, expect, test } from 'bun:test'
import type { StatisticsHistoryQueries } from '@brawltome/statistics'
import {
  type CareerWeaponHistoryViewSnapshot,
  type LegendMetaHistoryViewSnapshot,
  buildCareerWeaponUsageHistory,
  buildLegendMetaHistory,
} from '@brawltome/statistics'
import { statisticsRouter } from '../src/router/statistics.router'
import type { Context } from '../src/trpc/context'

const legendRow = {
  legend: { legendId: 3, name: 'Bödvar', slug: 'bodvar' },
  playerCount: 30,
  gameCount: 200,
  winCount: 100,
  medianRating: 2_000,
  pickShare: { numerator: 200, denominator: 200, basisPoints: 10_000 },
  adoption: { numerator: 30, denominator: 30, basisPoints: 10_000 },
  winRate: { numerator: 100, denominator: 200, basisPoints: 5_000 },
  uncertainty95: { lowerBasisPoints: 4_313, upperBasisPoints: 5_687 },
  eligible: true,
  rank: 1,
} as const

function legendSnapshot(snapshotId: string, generationId: string, publishedAt: string): LegendMetaHistoryViewSnapshot {
  return {
    snapshotId,
    generationId,
    publishedAt,
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    compatibility: {
      season: { applicability: 'required', identity: null },
      cohortMethodologyVersion: 'full-launch-cohort-v1',
      metricMethodologyVersion: 'current-season-legend-meta-v1',
      scope: { region: 'all', bracket: 'all' },
    },
    rows: [
      {
        legend: legendRow.legend,
        eligible: true,
        rank: 1,
        medianRating: 2_000,
        pickShareBasisPoints: 10_000,
        adoptionBasisPoints: 10_000,
        winRateBasisPoints: 5_000,
      },
    ],
    data: {
      region: 'all',
      bracket: 'all',
      selectedPlayers: 30,
      observedPlayers: 30,
      observedLegendGames: 200,
      coverage: { numerator: 30, denominator: 30, basisPoints: 10_000 },
      rows: [legendRow],
    },
  }
}

const careerRow: CareerWeaponHistoryViewSnapshot['data']['rows'][number] = {
  weapon: 'Hammer',
  observedPlayers: 30,
  prevalence: { numerator: '1', denominator: '1' },
  heldTimeSeconds: '108000',
  heldTimeShare: { numerator: '1', denominator: '1' },
  contributorCount: 30,
  qualifyingHeldSeconds: '108000',
  medianDamagePerMinute: { numerator: '1', denominator: '1' },
  medianKosPerHour: { numerator: '1', denominator: '1' },
  comparison: { eligible: true, reasons: [] },
}

function careerSnapshot(
  snapshotId: string,
  generationId: string,
  publishedAt: string,
  damageNumerator: string,
): CareerWeaponHistoryViewSnapshot {
  const row = {
    ...careerRow,
    medianDamagePerMinute: { numerator: damageNumerator, denominator: '1' },
  }
  return {
    snapshotId,
    generationId,
    publishedAt,
    observationWindow: { startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z' },
    compatibility: {
      season: { applicability: 'not-applicable' },
      cohortMethodologyVersion: 'full-launch-cohort-v1',
      metricMethodologyVersion: 'career-weapon-usage-v1',
      scope: { region: 'all', bracket: 'all' },
    },
    rows: [
      {
        weapon: row.weapon,
        eligible: true,
        prevalence: row.prevalence,
        heldTimeShare: row.heldTimeShare,
        medianDamagePerMinute: row.medianDamagePerMinute,
        medianKosPerHour: row.medianKosPerHour,
      },
    ],
    data: {
      selectedPlayers: 30,
      successfulObservations: 30,
      coverage: { numerator: '1', denominator: '1' },
      totalHeldSeconds: '108000',
      rows: [row],
    },
  }
}

function callerFor(statisticsHistoryQueries: StatisticsHistoryQueries) {
  return statisticsRouter.createCaller({ statisticsQueries: statisticsHistoryQueries } as unknown as Context)
}

describe('statistics history routes', () => {
  test('maps exposed Legend snapshots and the explicit null-season break', async () => {
    const newer = legendSnapshot(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '2026-08-15T00:00:00.000Z',
    )
    const older = legendSnapshot(
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000012',
      '2026-08-08T00:00:00.000Z',
    )
    const calls: unknown[] = []
    const caller = callerFor({
      async getLegendMetaHistory(input) {
        calls.push(input)
        return { status: 'available', ...input, entries: buildLegendMetaHistory([newer, older]) }
      },
      async getCareerWeaponUsageHistory(filters) {
        return { status: 'unavailable', reason: 'not-yet-published', filters }
      },
    })

    const output = await caller.legendMetaHistory({ region: 'all', bracket: 'all' })
    expect(output).toMatchObject({
      status: 'available',
      filter: { region: 'all', bracket: 'all' },
      entries: [
        {
          snapshot: { snapshotId: newer.snapshotId, season: { identity: null } },
          comparisonToPrevious: {
            status: 'incompatible',
            previousSnapshotId: older.snapshotId,
            reasons: [{ code: 'season_identity_unavailable' }],
          },
        },
        { snapshot: { snapshotId: older.snapshotId }, comparisonToPrevious: null },
      ],
    })
    expect(calls).toEqual([{ region: 'all', bracket: 'all' }])
  })

  test('maps exact Career deltas without season semantics', async () => {
    const newer = careerSnapshot(
      '10000000-0000-4000-8000-000000000021',
      '10000000-0000-4000-8000-000000000022',
      '2026-08-15T00:00:00.000Z',
      '2',
    )
    const older = careerSnapshot(
      '10000000-0000-4000-8000-000000000031',
      '10000000-0000-4000-8000-000000000032',
      '2026-08-08T00:00:00.000Z',
      '1',
    )
    const caller = callerFor({
      async getLegendMetaHistory(input) {
        return { status: 'unavailable', reason: 'not-yet-published', ...input }
      },
      async getCareerWeaponUsageHistory(filters) {
        return { status: 'available', filters, entries: buildCareerWeaponUsageHistory([newer, older]) }
      },
    })

    const output = await caller.careerWeaponUsageHistory({ region: 'all', bracket: 'all' })
    expect(output).toMatchObject({
      status: 'available',
      filters: { region: 'all', bracket: 'all' },
    })
    if (output.status === 'unavailable') throw new Error('expected Career history')
    expect(output.entries[0]?.comparisonToPrevious).toMatchObject({
      status: 'available',
      previousSnapshotId: older.snapshotId,
      deltas: [
        {
          weapon: 'Hammer',
          medianDamagePerMinute: {
            change: { numerator: '1', denominator: '1' },
            direction: 'increase',
          },
        },
      ],
    })
  })

  test('maps independent unavailable states and rejects unknown history filters', async () => {
    const caller = callerFor({
      async getLegendMetaHistory(input) {
        return { status: 'unavailable', reason: 'not-yet-published', ...input }
      },
      async getCareerWeaponUsageHistory(filters) {
        return { status: 'unavailable', reason: 'not-yet-published', filters }
      },
    })

    await expect(caller.legendMetaHistory({ region: 'EU', bracket: 'Platinum' })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filter: { region: 'EU', bracket: 'Platinum' },
    })
    await expect(caller.careerWeaponUsageHistory({ region: 'all', bracket: 'all' })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_yet_published',
      filters: { region: 'all', bracket: 'all' },
    })
    await expect(caller.legendMetaHistory({ region: 'EU', bracket: 'Platinum', depth: 20 } as never)).rejects.toThrow()
  })
})
