import type { Database } from '@brawltome/foundation'
import {
  type ActiveResourceOperation,
  findActiveOnResource,
  rankedCoverageCohort,
  recentlyViewedCohort,
  rewriteUnstartedOperation,
  type WorkClass,
} from '@brawltome/queue'
import {
  type InteractivePlayerRefreshPayload,
  interactivePlayerRefreshContract,
  type PlayerRefreshSection,
} from './interactive-player-refresh-contract'

const playerRefreshKind = 'interactive-player-refresh'
const sectionOrder: readonly PlayerRefreshSection[] = ['ranked', 'stats']
const backgroundCohorts: readonly unknown[] = [recentlyViewedCohort, rankedCoverageCohort]
// a takeover can race a worker's claim; after this many misses the visitor is told to ask again
const takeoverAttempts = 3

/**
 * What a visitor does about the refresh already holding their player:
 * - attach: it covers their sections and nothing about it needs to change, so they wait on it
 * - take-over: it hasn't started and either misses a section or sits in the background queue, so it becomes theirs
 * - wait-for-running: it's running without one of their sections, so they ask again once it ends
 */
export type VisitorFit =
  | { action: 'attach' }
  | { action: 'take-over'; workClass: WorkClass; payload: InteractivePlayerRefreshPayload }
  | { action: 'wait-for-running' }

export type VisitorTakeover =
  | { outcome: 'attached'; operationId: string }
  | { outcome: 'running' }
  | { outcome: 'none' }

function readPayload(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
}

function readSections(payload: Record<string, unknown>): readonly string[] {
  return Array.isArray(payload.staleSections) ? payload.staleSections : []
}

function joinSections(held: readonly string[], wanted: readonly PlayerRefreshSection[]): PlayerRefreshSection[] {
  return sectionOrder.filter((section) => held.includes(section) || wanted.includes(section))
}

function takenOverPayload(
  payload: Record<string, unknown>,
  _isBackgroundCohort: boolean,
  staleSections: PlayerRefreshSection[],
): InteractivePlayerRefreshPayload {
  return { ...(payload as InteractivePlayerRefreshPayload), staleSections }
}

/** Decides how a visitor needing these sections deals with the refresh already holding their player. */
export function fitForVisitor(
  active: Pick<ActiveResourceOperation, 'workClass' | 'status' | 'payload'>,
  staleSections: readonly PlayerRefreshSection[],
): VisitorFit {
  const payload = readPayload(active.payload)
  const heldSections = readSections(payload)
  const isCovering = staleSections.every((section) => heldSections.includes(section))
  const isBackgroundCohort = active.workClass === 'primary-monitoring' && backgroundCohorts.includes(payload.cohort)

  if (active.status === 'leased') return isCovering ? { action: 'attach' } : { action: 'wait-for-running' }

  if (isCovering && !isBackgroundCohort) return { action: 'attach' }

  const sections = joinSections(heldSections, staleSections)

  return {
    action: 'take-over',
    workClass: isBackgroundCohort ? 'interactive' : active.workClass,
    payload: takenOverPayload(payload, isBackgroundCohort, sections),
  }
}

function readActivePlayerRefresh(database: Database, brawlhallaId: number) {
  return findActiveOnResource(database, { kind: playerRefreshKind, resourceKey: `player:${brawlhallaId}` })
}

/** How a visitor would deal with the player's active refresh, without changing it; null when there is none. */
export async function inspectVisitorFit(
  database: Database,
  input: { brawlhallaId: number; staleSections: readonly PlayerRefreshSection[] },
): Promise<VisitorFit['action'] | null> {
  const active = await readActivePlayerRefresh(database, input.brawlhallaId)

  return active ? fitForVisitor(active, input.staleSections).action : null
}

/**
 * Makes the player's active refresh cover the visitor: a refresh nobody started takes on their sections, and a
 * background one becomes interactive work. Only for a visitor who passed verification and admission.
 */
export async function takeOverPlayerRefresh(
  database: Database,
  input: { brawlhallaId: number; staleSections: readonly PlayerRefreshSection[] },
): Promise<VisitorTakeover> {
  for (let attempt = 0; attempt < takeoverAttempts; attempt++) {
    const active = await readActivePlayerRefresh(database, input.brawlhallaId)

    if (!active) return { outcome: 'none' }

    const fit = fitForVisitor(active, input.staleSections)

    if (fit.action === 'attach') return { outcome: 'attached', operationId: active.operationId }

    if (fit.action === 'wait-for-running') return { outcome: 'running' }

    const isRewritten = await rewriteUnstartedOperation(database, {
      job: interactivePlayerRefreshContract,
      operationId: active.operationId,
      workClass: fit.workClass,
      payload: fit.payload,
    })

    if (isRewritten) return { outcome: 'attached', operationId: active.operationId }
  }

  return { outcome: 'running' }
}
