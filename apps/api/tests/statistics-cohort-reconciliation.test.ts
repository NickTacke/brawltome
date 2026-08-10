import { describe, expect, test } from 'bun:test'
import type { RankingQueries } from '@brawltome/ranking'
import type { StatisticsOperations } from '@brawltome/refresh-operations'
import { type StatisticsTracer, launchCohortRegions } from '@brawltome/statistics'
import {
  loadFullLaunchCohortCandidates,
  loadLaunchCohortCandidates,
  reconcileStatisticsCohort,
} from '../src/statistics-cohort-reconciliation'

const snapshotId = '00000000-0000-4000-8000-000000000001'
const generationId = '10000000-0000-4000-8000-000000000001'

function view(page: number, ids: number[], hasMore: boolean) {
  return {
    status: 'fresh' as const,
    snapshotId,
    generationId,
    mode: '1v1' as const,
    region: 'EU' as const,
    observedAt: '2026-08-10T00:00:00.000Z',
    publishedAt: '2026-08-10T00:01:00.000Z',
    expectedNextPublicationAt: '2026-08-17T00:00:00.000Z',
    provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 1 as const, pageDepth: 2 },
    page,
    pageSize: 100,
    hasMore,
    totalRows: 3,
    entries: ids.map((id, index) => ({
      standing: (page - 1) * 100 + index + 1,
      sourceRank: (page - 1) * 100 + index + 1,
      identity: { type: 'one-vs-one-player' as const, player: { brawlhallaId: id, name: `Player ${id}` } },
      region: 'EU' as const,
      rating: 2000 + id,
      peakRating: 2100 + id,
      wins: 10,
      losses: 5,
      games: 15,
      tier: 'Diamond',
    })),
  }
}

describe('Statistics immutable Ranking adapter', () => {
  test('pins every page to the first snapshot and preserves generation lineage', async () => {
    const calls: Array<{ page: number; snapshotId?: string }> = []
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        calls.push({ page: input.page, snapshotId: input.snapshotId })
        return input.page === 1 ? view(1, [1, 2], true) : view(2, [3], false)
      },
    }
    expect(await loadLaunchCohortCandidates(ranking)).toEqual({
      snapshotId,
      generationId,
      observedAt: '2026-08-10T00:00:00.000Z',
      region: 'EU',
      mode: '1v1',
      candidates: [
        { brawlhallaId: 1, rating: 2001 },
        { brawlhallaId: 2, rating: 2002 },
        { brawlhallaId: 3, rating: 2003 },
      ],
    })
    expect(calls).toEqual([
      { page: 1, snapshotId: undefined },
      { page: 2, snapshotId },
    ])
  })

  test('loads exactly all nine pinned regional snapshots from one immutable generation', async () => {
    const calls: string[] = []
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        calls.push(`${input.region}:${input.page}`)
        const regionIndex = launchCohortRegions.indexOf(input.region as (typeof launchCohortRegions)[number])
        const regionalSnapshotId = `00000000-0000-4000-8000-${String(regionIndex + 1).padStart(12, '0')}`
        const regional = view(1, [regionIndex + 1], false)
        return {
          ...regional,
          snapshotId: regionalSnapshotId,
          region: input.region as (typeof launchCohortRegions)[number],
          entries: regional.entries.map((entry) => ({
            ...entry,
            region: input.region as (typeof launchCohortRegions)[number],
          })),
        }
      },
    }

    const snapshots = await loadFullLaunchCohortCandidates(ranking)
    expect(snapshots?.map(({ region }) => region)).toEqual([...launchCohortRegions])
    expect(new Set(snapshots?.map(({ generationId }) => generationId))).toEqual(new Set([generationId]))
    expect(calls).toEqual(launchCohortRegions.map((region) => `${region}:1`))
  })

  test('creates the full generation and initializes preserved #209 evidence on a fresh deployment', async () => {
    let reconciledSnapshots = 0
    const reconciledLegacyRegions: string[] = []
    const launchAudit = {
      generationId,
      methodologyVersion: 'full-launch-cohort-v1',
      sourceGenerationId: generationId,
      sourceObservedAt: '2026-08-10T00:00:00.000Z',
      observationWindow: { startsAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-17T00:00:00.000Z' },
      capacityEnvelope: {},
      selectedPlayers: 0,
      state: 'insufficient-evidence',
      cells: [],
      decisions: [],
    } as never
    const statistics = {
      reconciliationState: async () => ({ legacyCohortExists: false, launch: null }),
      reconcileCohort: async (snapshot: { region: string }) => {
        reconciledLegacyRegions.push(snapshot.region)
        return { members: [] }
      },
      reconcileLaunchCohort: async (snapshots: unknown[]) => {
        reconciledSnapshots = snapshots.length
        return launchAudit
      },
      boundCollectionOperationIds: async () => [],
      collectionIntents: async () => [],
      boundPublicationOperationIds: async () => [],
      publicationIntents: async () => [],
    } as unknown as StatisticsTracer
    const operations = {
      listAwaitingStatisticsCollections: async () => [],
      listAwaitingStatisticsPublications: async () => [],
    } as unknown as StatisticsOperations
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        const regionIndex = launchCohortRegions.indexOf(input.region as (typeof launchCohortRegions)[number])
        const regional = view(1, [regionIndex + 1], false)
        return {
          ...regional,
          snapshotId: `00000000-0000-4000-8000-${String(regionIndex + 1).padStart(12, '0')}`,
          region: input.region as (typeof launchCohortRegions)[number],
        }
      },
    }

    expect(await reconcileStatisticsCohort(statistics, operations, ranking)).toBe(2)
    expect(reconciledLegacyRegions).toEqual(['EU'])
    expect(reconciledSnapshots).toBe(9)
  })

  test('initializes #209 from EU when another launch region is unavailable', async () => {
    let legacyReconciliations = 0
    let launchReconciliations = 0
    const statistics = {
      reconciliationState: async () => ({ legacyCohortExists: false, launch: null }),
      reconcileCohort: async () => {
        legacyReconciliations++
        return { members: [] }
      },
      reconcileLaunchCohort: async () => {
        launchReconciliations++
        throw new Error('full launch cohort must wait for all regions')
      },
      boundCollectionOperationIds: async () => [],
      collectionIntents: async () => [],
      boundPublicationOperationIds: async () => [],
      publicationIntents: async () => [],
    } as unknown as StatisticsTracer
    const operations = {
      listAwaitingStatisticsCollections: async () => [],
      listAwaitingStatisticsPublications: async () => [],
    } as unknown as StatisticsOperations
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        if (input.region !== 'EU') {
          return {
            status: 'unavailable',
            reason: 'not_yet_published',
            mode: input.mode,
            page: input.page,
            pageSize: input.pageSize ?? 50,
          }
        }
        return view(1, [1], false)
      },
    }

    expect(await reconcileStatisticsCohort(statistics, operations, ranking)).toBe(1)
    expect(legacyReconciliations).toBe(1)
    expect(launchReconciliations).toBe(0)
  })

  test('bounds one saturated reconciliation pass without loading the full cohort audit', async () => {
    const awaitingCollections = Array.from({ length: 500 }, (_, index) => `awaiting-collection-${index}`)
    const awaitingPublications = Array.from({ length: 100 }, (_, index) => `awaiting-publication-${index}`)
    const intents = Array.from({ length: 500 }, (_, index) => ({
      cohortId: '20000000-0000-4000-8000-000000000001',
      brawlhallaId: index + 1,
      product: 'ranked' as const,
      kind: 'statistics-ranked-collection' as const,
      operationKey: `statistics:cohort:${index + 1}:ranked:v1`,
    }))
    let collectionBindingLookups = 0
    let publicationBindingLookups = 0
    let activatedCollections = 0
    let activatedPublications = 0
    const statistics = {
      reconciliationState: async () => ({
        legacyCohortExists: true,
        launch: {
          generationId,
          sourceGenerationId: generationId,
          decisionCount: 0,
          cohortIds: ['20000000-0000-4000-8000-000000000001'],
        },
      }),
      boundCollectionOperationIds: async (operationIds: readonly string[]) => {
        collectionBindingLookups = operationIds.length
        return [...operationIds]
      },
      collectionIntents: async () => intents,
      recordCollectionOperation: async () => {},
      boundPublicationOperationIds: async (operationIds: readonly string[]) => {
        publicationBindingLookups = operationIds.length
        return [...operationIds]
      },
      publicationIntents: async () => [],
    } as unknown as StatisticsTracer
    const operations = {
      listAwaitingStatisticsCollections: async () => awaitingCollections,
      activateStatisticsCollection: async () => {
        activatedCollections++
        return 'transitioned' as const
      },
      reserveStatisticsCollection: async (_input: unknown) => ({
        outcome: 'accepted' as const,
        operationId: '30000000-0000-4000-8000-000000000001',
      }),
      listAwaitingStatisticsPublications: async () => awaitingPublications,
      activateStatisticsPublication: async () => {
        activatedPublications++
        return 'transitioned' as const
      },
    } as unknown as StatisticsOperations
    const ranking: RankingQueries = {
      async getLeaderboard() {
        throw new Error('settled generation must not reload Ranking snapshots')
      },
    }

    expect(await reconcileStatisticsCohort(statistics, operations, ranking)).toBe(500)
    expect(collectionBindingLookups).toBe(500)
    expect(publicationBindingLookups).toBe(100)
    expect(activatedCollections).toBe(1_000)
    expect(activatedPublications).toBe(100)
  })

  test('returns no cohort before Rankings publishes the EU snapshot', async () => {
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        return {
          status: 'unavailable',
          reason: 'not_yet_published',
          mode: input.mode,
          page: input.page,
          pageSize: input.pageSize ?? 50,
        }
      },
    }
    expect(await loadLaunchCohortCandidates(ranking)).toBeNull()
  })
})
