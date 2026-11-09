import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import {
  acceptOperation,
  countActive,
  interactiveRefreshMaxAttempts,
  readAttemptHistory,
  recentlyViewedCohort,
} from '@brawltome/refresh-operations'
import { interactivePlayerRefreshContract } from './interactive-player-refresh-contract'

const playerRefreshKind = 'interactive-player-refresh'
const freshnessPlannerSource = 'freshness-planner'
// overlay lookups and requests that were rate limited or abandoned are not someone reading the profile
const demandSources = ['interactive-api', 'discord']
const demandExcludedErrorCodes = ['actor_rate_limited', 'admission_reservation_expired']

// days within the window on which a player's profile was refreshed on request: demand the view counter cannot see
// (Discord lookups, views before the counter existed)
export type RefreshRequestDemand = { brawlhallaId: number; viewDays: number }
// the freshness planner's own last background refresh for a player and its last dead-lettered one, if any
export type FreshnessAttempt = { brawlhallaId: number; lastPlannedAt: Date | null; lastFailedAt: Date | null }

export function activeRecentlyViewedRefreshes(database: Database): Promise<number> {
  return countActive(database, {
    kind: playerRefreshKind,
    workClass: 'primary-monitoring',
    payloadEquals: { cohort: recentlyViewedCohort },
  })
}

// a player with any active refresh, a visitor's included, is skipped: the active-resource index allows one at a time
export async function enqueueRecentlyViewedRefreshes(
  database: Database,
  brawlhallaIds: readonly number[],
): Promise<number[]> {
  const enqueued: number[] = []

  for (const brawlhallaId of brawlhallaIds) {
    if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) {
      throw new Error('recently viewed refresh brawlhallaId must be a positive 32-bit integer')
    }

    const accepted = await acceptOperation(database, {
      job: interactivePlayerRefreshContract,
      dedupeKey: `freshness:${brawlhallaId}`,
      operationKey: `freshness:${brawlhallaId}:${randomUUID()}`,
      resourceKey: `player:${brawlhallaId}`,
      workClass: 'primary-monitoring',
      payload: { cohort: recentlyViewedCohort, brawlhallaId, staleSections: ['ranked', 'stats'] },
      provenance: { source: freshnessPlannerSource },
      maxAttempts: interactiveRefreshMaxAttempts,
    })

    if (accepted.outcome === 'accepted') enqueued.push(brawlhallaId)
  }

  return enqueued
}

/** Distinct days on which site or Discord visitors requested a player's refresh. */
export async function refreshRequestDemand(
  database: Database,
  input: { windowDays: number },
): Promise<RefreshRequestDemand[]> {
  const history = await readAttemptHistory(database, {
    kind: playerRefreshKind,
    groupByPayloadField: 'brawlhallaId',
    windowDays: input.windowDays,
    workClass: 'interactive',
    provenanceSources: demandSources,
    excludedErrorCodes: demandExcludedErrorCodes,
  })

  return history.map((row) => ({ brawlhallaId: Number(row.payloadValue), viewDays: row.createdDays }))
}

export async function recentFreshnessAttempts(
  database: Database,
  input: { windowDays: number },
): Promise<FreshnessAttempt[]> {
  const history = await readAttemptHistory(database, {
    kind: playerRefreshKind,
    groupByPayloadField: 'brawlhallaId',
    windowDays: input.windowDays,
    provenanceSources: [freshnessPlannerSource],
  })

  return history.map((row) => ({
    brawlhallaId: Number(row.payloadValue),
    lastPlannedAt: row.lastCreatedAt,
    lastFailedAt: row.lastDeadLetteredAt,
  }))
}

/** The planner's queue operations bound to one database. */
export function createRecentlyViewedRefreshes(database: Database) {
  return {
    activeRecentlyViewedRefreshes: () => activeRecentlyViewedRefreshes(database),

    enqueueRecentlyViewedRefreshes: (brawlhallaIds: readonly number[]) =>
      enqueueRecentlyViewedRefreshes(database, brawlhallaIds),

    refreshRequestDemand: (input: { windowDays: number }) => refreshRequestDemand(database, input),

    recentFreshnessAttempts: (input: { windowDays: number }) => recentFreshnessAttempts(database, input),
  }
}
