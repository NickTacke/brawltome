import type { RankingQueries } from '@brawltome/ranking'
import type { StatisticsOperations } from '@brawltome/refresh-operations'
import {
  type CohortCandidateSnapshot,
  type LaunchCohortRegion,
  type StatisticsTracer,
  launchCohortRegions,
} from '@brawltome/statistics'

export async function loadLaunchCohortCandidates(
  ranking: RankingQueries,
  region: LaunchCohortRegion = 'EU',
): Promise<CohortCandidateSnapshot | null> {
  const first = await ranking.getLeaderboard({ mode: '1v1', region, page: 1, pageSize: 100 })
  if (first.status === 'unavailable') return null
  if (first.mode !== '1v1' || first.region !== region) {
    throw new Error(`Statistics cohort requires the ${region} 1v1 Ranking snapshot`)
  }
  const candidates: CohortCandidateSnapshot['candidates'] = []
  let page = first
  for (;;) {
    if (
      page.snapshotId !== first.snapshotId ||
      page.generationId !== first.generationId ||
      page.region !== region ||
      page.mode !== '1v1'
    ) {
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
      region,
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
    region,
    mode: '1v1',
    candidates,
  }
}

export async function loadFullLaunchCohortCandidates(
  ranking: RankingQueries,
): Promise<CohortCandidateSnapshot[] | null> {
  const snapshots = await Promise.all(launchCohortRegions.map((region) => loadLaunchCohortCandidates(ranking, region)))
  return snapshots.some((snapshot) => snapshot === null) ? null : (snapshots as CohortCandidateSnapshot[])
}

export async function reconcileStatisticsCohort(
  statistics: StatisticsTracer,
  operations: StatisticsOperations,
  ranking: RankingQueries,
): Promise<number> {
  let reconciled = 0
  const state = await statistics.reconciliationState()
  let launchState = state.launch
  const needsLaunchSnapshot = !launchState || launchState.decisionCount === 2
  if (!state.legacyCohortExists || needsLaunchSnapshot) {
    const candidates = await Promise.all(
      launchCohortRegions.map((region) => loadLaunchCohortCandidates(ranking, region)),
    )
    const euSnapshot = candidates.find((snapshot) => snapshot?.region === 'EU')
    if (!state.legacyCohortExists && euSnapshot) {
      await statistics.reconcileCohort(euSnapshot)
      reconciled++
    }
    const completeCandidates = candidates.every((snapshot) => snapshot !== null)
      ? (candidates as CohortCandidateSnapshot[])
      : null
    const sourceGenerations = new Set(completeCandidates?.map(({ generationId }) => generationId))
    if (
      needsLaunchSnapshot &&
      completeCandidates &&
      (sourceGenerations.size !== 1 || completeCandidates[0].generationId !== launchState?.sourceGenerationId)
    ) {
      const launch = await statistics.reconcileLaunchCohort(completeCandidates)
      launchState = {
        generationId: launch.generationId,
        sourceGenerationId: launch.sourceGenerationId,
        decisionCount: launch.decisions.length,
        cohortIds: launch.cells.map(({ cohortId }) => cohortId),
      }
      reconciled++
    }
  }

  const awaitingCollections = await operations.listAwaitingStatisticsCollections()
  const boundCollectionOperationIds = new Set(await statistics.boundCollectionOperationIds(awaitingCollections))
  for (const operationId of awaitingCollections) {
    if (boundCollectionOperationIds.has(operationId)) await operations.activateStatisticsCollection(operationId)
  }

  const launchCohortIds = new Set(launchState?.cohortIds ?? [])
  for (const intent of await statistics.collectionIntents()) {
    const accepted = await operations.reserveStatisticsCollection({
      kind: intent.kind,
      dedupeKey: intent.operationKey,
      operationKey: intent.operationKey,
      workClass: 'global-statistics',
      payload: { cohortId: intent.cohortId, brawlhallaId: intent.brawlhallaId },
      provenance: {
        source: 'statistics-cohort-reconciliation',
        requestedBy: launchCohortIds.has(intent.cohortId) ? 'issue-210' : 'issue-209',
      },
      maxAttempts: 3,
    })
    await statistics.recordCollectionOperation(intent, accepted.operationId)
    if ((await operations.activateStatisticsCollection(accepted.operationId)) !== 'transitioned') {
      throw new Error('reserved Statistics collection could not be activated after owner binding')
    }
    if (accepted.outcome === 'accepted') reconciled++
  }

  const awaitingPublications = await operations.listAwaitingStatisticsPublications()
  const boundPublicationOperationIds = new Set(await statistics.boundPublicationOperationIds(awaitingPublications))
  for (const operationId of awaitingPublications) {
    if (boundPublicationOperationIds.has(operationId)) await operations.activateStatisticsPublication(operationId)
  }
  for (const intent of await statistics.publicationIntents()) {
    const accepted = await operations.reserveStatisticsPublication({
      kind: intent.kind,
      dedupeKey: intent.operationKey,
      operationKey: intent.operationKey,
      workClass: 'global-statistics',
      payload: { generationId: intent.generationId, product: intent.product },
      provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
      maxAttempts: 3,
    })
    if ((await statistics.recordPublicationOperation(intent, accepted.operationId)) === 'collection-active') continue
    if ((await operations.activateStatisticsPublication(accepted.operationId)) !== 'transitioned') {
      throw new Error('reserved Statistics publication could not be activated after owner binding')
    }
    if (accepted.outcome === 'accepted') reconciled++
  }
  return reconciled
}
