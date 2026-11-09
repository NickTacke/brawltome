import type { Database } from '@brawltome/foundation'
import {
  type ReconcileResourceSchedulesResult,
  type ResourceSchedule,
  reconcileResourceSchedules,
} from '@brawltome/refresh-operations'
import { primaryMonitoringWatermark } from '../db/primary-monitoring-watermark'
import { interactivePlayerRefreshContract } from './interactive-player-refresh-contract'

const primaryMonitoringSource = 'primary-player-monitoring'
const primaryMonitoringIntervalMs = 24 * 60 * 60 * 1000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PrimaryMonitoringTarget = {
  assignmentId: string
  brawlhallaId: number
  verifiedAt: Date
}

export type PrimaryMonitoringSnapshot = {
  observedAt: Date
  targets: PrimaryMonitoringTarget[]
}

function validateMonitoringTarget(target: PrimaryMonitoringTarget): void {
  if (!Number.isSafeInteger(target.brawlhallaId) || target.brawlhallaId <= 0) {
    throw new Error('Primary monitoring requires a positive safe Brawlhalla ID')
  }

  if (!uuidPattern.test(target.assignmentId)) {
    throw new Error('Primary monitoring requires a UUID assignmentId')
  }
}

function monitoringSchedule(target: PrimaryMonitoringTarget): ResourceSchedule {
  validateMonitoringTarget(target)

  return {
    job: interactivePlayerRefreshContract,
    scheduleKey: `primary-player:${target.brawlhallaId}:${target.assignmentId}`,
    operationKeyPrefix: `primary-player:${target.brawlhallaId}`,
    resourceKey: `player:${target.brawlhallaId}`,
    workClass: 'primary-monitoring',
    intervalMs: primaryMonitoringIntervalMs,
    firstDueAt: new Date(target.verifiedAt.getTime() + primaryMonitoringIntervalMs).toISOString(),
    payload: {
      assignmentId: target.assignmentId,
      brawlhallaId: target.brawlhallaId,
      staleSections: ['ranked', 'stats'],
    },
    provenance: { source: primaryMonitoringSource, requestedBy: 'issue-208' },
    maxAttempts: 3,
  }
}

/** Keeps one enabled refresh schedule per verified primary player, replacing a schedule whose assignment changed. */
export async function reconcilePrimaryMonitoring(
  database: Database,
  snapshot: PrimaryMonitoringSnapshot,
): Promise<ReconcileResourceSchedulesResult> {
  if (!(snapshot.observedAt instanceof Date) || Number.isNaN(snapshot.observedAt.getTime())) {
    throw new Error('Primary monitoring snapshot requires a valid observedAt')
  }

  const schedules = snapshot.targets.map(monitoringSchedule)

  if (new Set(schedules.map(({ resourceKey }) => resourceKey)).size !== schedules.length) {
    throw new Error('Primary monitoring snapshot contains duplicate players')
  }

  return reconcileResourceSchedules(database, {
    provenanceSource: primaryMonitoringSource,
    observedAt: snapshot.observedAt,
    schedules,
    watermark: primaryMonitoringWatermark,
    identityPayloadFields: ['assignmentId', 'brawlhallaId'],
  })
}
