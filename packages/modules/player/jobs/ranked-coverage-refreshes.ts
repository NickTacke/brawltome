import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import {
  acceptOperation,
  interactiveRefreshMaxAttempts,
  rankedCoverageCohort,
  readAttemptHistory,
} from '@brawltome/queue'
import { activeBackgroundPlayerRefreshes, activeInteractivePlayerRefreshes } from './active-player-refreshes'
import { interactivePlayerRefreshContract } from './interactive-player-refresh-contract'
import type { FreshnessAttempt } from './recently-viewed-refreshes'

const playerRefreshKind = 'interactive-player-refresh'
const rankedCoverageSource = 'ranked-coverage'

// false when the player already has an active refresh: the active-resource index allows one at a time
export async function enqueueRankedCoverageRefresh(database: Database, brawlhallaId: number): Promise<boolean> {
  if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) {
    throw new Error(`enqueue ranked coverage refresh for player ${brawlhallaId}: not a positive 32-bit integer`)
  }

  const accepted = await acceptOperation(database, {
    job: interactivePlayerRefreshContract,
    dedupeKey: `coverage:${brawlhallaId}`,
    operationKey: `coverage:${brawlhallaId}:${randomUUID()}`,
    resourceKey: `player:${brawlhallaId}`,
    workClass: 'primary-monitoring',
    payload: { cohort: rankedCoverageCohort, brawlhallaId, staleSections: ['ranked'] },
    provenance: { source: rankedCoverageSource },
    maxAttempts: interactiveRefreshMaxAttempts,
  })

  return accepted.outcome === 'accepted'
}

/** The coverage planner's own last refresh for each player and its last dead-lettered one, if any. */
export async function recentRankedCoverageAttempts(
  database: Database,
  input: { windowDays: number },
): Promise<FreshnessAttempt[]> {
  const history = await readAttemptHistory(database, {
    kind: playerRefreshKind,
    groupByPayloadField: 'brawlhallaId',
    windowDays: input.windowDays,
    provenanceSources: [rankedCoverageSource],
  })

  return history.map((row) => ({
    brawlhallaId: Number(row.payloadValue),
    lastPlannedAt: row.lastCreatedAt,
    lastFailedAt: row.lastDeadLetteredAt,
  }))
}

/** The coverage planner's queue operations bound to one database. */
export function createRankedCoverageRefreshes(database: Database) {
  return {
    activeBackgroundPlayerRefreshes: () => activeBackgroundPlayerRefreshes(database),

    activeInteractivePlayerRefreshes: () => activeInteractivePlayerRefreshes(database),

    enqueueRankedCoverageRefresh: (brawlhallaId: number) => enqueueRankedCoverageRefresh(database, brawlhallaId),

    recentRankedCoverageAttempts: (input: { windowDays: number }) => recentRankedCoverageAttempts(database, input),
  }
}

export type RankedCoverageRefreshes = ReturnType<typeof createRankedCoverageRefreshes>
