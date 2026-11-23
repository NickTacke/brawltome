import type { Database } from '@brawltome/foundation'
import {
  findActiveOnResource,
  promotePendingWorkClass,
  rankedCoverageCohort,
  recentlyViewedCohort,
  type Transaction,
} from '@brawltome/queue'
import type { PlayerRefreshSection } from './interactive-player-refresh-contract'

const playerRefreshKind = 'interactive-player-refresh'
const sectionOrder: readonly PlayerRefreshSection[] = ['ranked', 'stats']

// a visitor may find a background refresh of the player still running; it's done in seconds, so they ask again
export type BackgroundHandover = 'free' | 'background-running'

function playerResourceKey(brawlhallaId: number): string {
  return `player:${brawlhallaId}`
}

// a coverage refresh fetches the ranked section only, so it takes on whatever else the visitor is missing
function coverageSectionsFor(staleSections: readonly PlayerRefreshSection[]): PlayerRefreshSection[] {
  return sectionOrder.filter((section) => section === 'ranked' || staleSections.includes(section))
}

function readSections(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null || !('staleSections' in payload)) return []

  return Array.isArray(payload.staleSections) ? payload.staleSections : []
}

/**
 * A visitor outranks the background: a queued recently viewed or coverage refresh of the player becomes interactive
 * work, so the visitor waits on interactive priority, and a coverage refresh also takes on the visitor's sections.
 */
export async function promoteBackgroundRefreshes(
  transaction: Transaction,
  input: { brawlhallaId: number; staleSections: readonly PlayerRefreshSection[] },
): Promise<void> {
  const promotion = {
    kind: playerRefreshKind,
    resourceKey: playerResourceKey(input.brawlhallaId),
    from: 'primary-monitoring',
    to: 'interactive',
  } as const

  await promotePendingWorkClass(transaction, { ...promotion, payloadEquals: { cohort: recentlyViewedCohort } })

  await promotePendingWorkClass(transaction, {
    ...promotion,
    payloadEquals: { cohort: rankedCoverageCohort },
    payloadMerge: { staleSections: coverageSectionsFor(input.staleSections) },
  })
}

/**
 * Hands a queued background refresh of the player to a visitor before they attach to it. A background refresh
 * already running can't change, so when it misses one of the visitor's sections they have to ask again once it ends.
 */
export async function handBackgroundRefreshToVisitor(
  database: Database,
  input: { brawlhallaId: number; staleSections: readonly PlayerRefreshSection[] },
): Promise<BackgroundHandover> {
  await database.db.transaction((transaction) => promoteBackgroundRefreshes(transaction, input))

  const active = await findActiveOnResource(database, {
    kind: playerRefreshKind,
    resourceKey: playerResourceKey(input.brawlhallaId),
  })

  if (!active || active.workClass === 'interactive') return 'free'

  const sections = readSections(active.payload)
  const isCovering = input.staleSections.every((section) => sections.includes(section))

  return isCovering ? 'free' : 'background-running'
}
