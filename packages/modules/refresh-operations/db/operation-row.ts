import { isDiscoveryProjectionKind, isLeaderboardKind, isStatisticsCollectionKind } from '../domain/operation-kinds'
import { type OperationLease, recentlyViewedCohort, type WorkClass } from '../model'

export type OperationRow = {
  id: string
  effect_operation_id: string
  effect_created_at: string
  kind: OperationLease['kind']
  operation_key: string
  work_class: WorkClass
  payload: OperationLease['payload']
  provenance: { source: string; requestedBy?: string }
  lease_owner: string
  lease_token: string | number
  attempt_count: number
  max_attempts: number
  status: string
  scheduled_window_at: Date | null
}

export function toLease(row: OperationRow): OperationLease {
  const common = {
    operationId: row.id,
    effectOperationId: row.effect_operation_id,
    effectCreatedAt: row.effect_created_at,
    operationKey: row.operation_key,
    provenance: row.provenance,
    leaseOwner: row.lease_owner,
    leaseToken: Number(row.lease_token),
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
    scheduleWindowAt: row.scheduled_window_at?.toISOString() ?? null,
  }

  if (isLeaderboardKind(row.kind)) {
    if (row.work_class !== 'leaderboard' || !('pageDepth' in row.payload)) {
      throw new Error('invalid durable leaderboard operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (isDiscoveryProjectionKind(row.kind)) {
    if (row.work_class !== 'projection' || !('batchSize' in row.payload)) {
      throw new Error('invalid durable discovery projection operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'discovery-reconciliation') {
    if (row.work_class !== 'projection' || !('owner' in row.payload)) {
      throw new Error('invalid durable discovery reconciliation operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'interactive-player-refresh') {
    if (
      (row.work_class !== 'interactive' && row.work_class !== 'primary-monitoring') ||
      !('brawlhallaId' in row.payload) ||
      !('staleSections' in row.payload)
    ) {
      throw new Error('invalid durable player refresh operation')
    }

    if (row.work_class === 'primary-monitoring') {
      if ('assignmentId' in row.payload) {
        return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
      }

      if ('cohort' in row.payload && row.payload.cohort === recentlyViewedCohort) {
        return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
      }

      throw new Error('invalid durable Primary monitoring operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'clan-refresh') {
    if (row.work_class !== 'interactive' || !('clanId' in row.payload)) {
      throw new Error('invalid durable clan refresh operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'ranked-player-pulse') {
    if (row.work_class !== 'primary-monitoring' || !('brawlhallaId' in row.payload) || 'staleSections' in row.payload) {
      throw new Error('invalid durable ranked player pulse operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'player-name-verification') {
    if (row.work_class !== 'maintenance' || !('playerName' in row.payload) || !('brawlhallaId' in row.payload)) {
      throw new Error('invalid durable player name verification operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'ranking-retention') {
    if (row.work_class !== 'maintenance' || !('retentionHours' in row.payload) || !('maxGenerations' in row.payload)) {
      throw new Error('invalid durable ranking retention operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'leaderboard-deep-crawl') {
    if (row.work_class !== 'leaderboard' || !('region' in row.payload) || !('intervalMs' in row.payload)) {
      throw new Error('invalid durable leaderboard deep crawl operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (isStatisticsCollectionKind(row.kind)) {
    if (row.work_class !== 'global-statistics' || !('cohortId' in row.payload) || !('brawlhallaId' in row.payload)) {
      throw new Error('invalid durable statistics collection operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'statistics-publication') {
    if (row.work_class !== 'global-statistics' || !('generationId' in row.payload) || !('product' in row.payload)) {
      throw new Error('invalid durable statistics publication operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind === 'statistics-legend-meta-publication') {
    if (row.work_class !== 'global-statistics' || !('generationId' in row.payload) || 'product' in row.payload) {
      throw new Error('invalid durable Statistics Legend Meta publication operation')
    }

    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }

  if (row.kind !== 'proof' || !('value' in row.payload)) throw new Error('invalid durable proof operation')

  return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
}
