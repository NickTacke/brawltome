import type { RankingQueries } from '@brawltome/ranking'
import type { StatisticsCollectionOperations } from '@brawltome/refresh-operations'
import type { CohortCandidateSnapshot, StatisticsTracer } from '@brawltome/statistics'

type StatisticsOperationAcceptance = StatisticsCollectionOperations

export async function loadLaunchCohortCandidates(ranking: RankingQueries): Promise<CohortCandidateSnapshot | null> {
  const first = await ranking.getLeaderboard({ mode: '1v1', region: 'EU', page: 1, pageSize: 100 })
  if (first.status === 'unavailable') return null
  if (first.mode !== '1v1' || first.region !== 'EU') {
    throw new Error('Statistics cohort requires an EU 1v1 Ranking snapshot')
  }
  const candidates: CohortCandidateSnapshot['candidates'] = []
  let page = first
  for (;;) {
    if (page.snapshotId !== first.snapshotId || page.generationId !== first.generationId) {
      throw new Error('Statistics leaderboard pagination crossed immutable generation identity')
    }
    for (const entry of page.entries) {
      if (entry.identity.type !== 'one-vs-one-player') {
        throw new Error('Statistics 1v1 snapshot contains a non-player identity')
      }
      candidates.push({ brawlhallaId: entry.identity.player.brawlhallaId, rating: entry.rating })
    }
    if (!page.hasMore) break
    const next = await ranking.getLeaderboard({
      mode: '1v1',
      region: 'EU',
      page: page.page + 1,
      pageSize: page.pageSize,
      snapshotId: first.snapshotId,
    })
    if (next.status === 'unavailable') throw new Error('pinned Statistics leaderboard snapshot disappeared')
    page = next
  }
  return {
    snapshotId: first.snapshotId,
    generationId: first.generationId,
    observedAt: first.observedAt,
    region: 'EU',
    mode: '1v1',
    candidates,
  }
}

export async function reconcileStatisticsCohort(
  statistics: StatisticsTracer,
  operations: StatisticsOperationAcceptance,
  ranking: RankingQueries,
): Promise<number> {
  let reconciled = 0
  if (!(await statistics.getCohort())) {
    const snapshot = await loadLaunchCohortCandidates(ranking)
    if (!snapshot) return 0
    await statistics.reconcileCohort(snapshot)
    reconciled++
  }
  const audit = await statistics.getCohort()
  const boundOperationIds = new Set(
    audit?.members.flatMap((member) =>
      [member.rankedOperationId, member.lifetimeOperationId].filter((id): id is string => id !== null),
    ) ?? [],
  )
  for (const operationId of await operations.listAwaitingStatisticsCollections()) {
    if (boundOperationIds.has(operationId)) await operations.activateStatisticsCollection(operationId)
  }

  for (const intent of await statistics.collectionIntents()) {
    const accepted = await operations.reserveStatisticsCollection({
      kind: intent.kind,
      dedupeKey: intent.operationKey,
      operationKey: intent.operationKey,
      workClass: 'global-statistics',
      payload: { cohortId: intent.cohortId, brawlhallaId: intent.brawlhallaId },
      provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
      maxAttempts: 3,
    })
    await statistics.recordCollectionOperation(intent, accepted.operationId)
    if ((await operations.activateStatisticsCollection(accepted.operationId)) !== 'transitioned') {
      throw new Error('reserved Statistics collection could not be activated after owner binding')
    }
    if (accepted.outcome === 'accepted') reconciled++
  }
  return reconciled
}
