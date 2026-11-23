import type { Database } from '@brawltome/foundation'
import {
  type ActiveOperation,
  type ActiveOperationDetails,
  findActiveOperationDetails,
  rankedCoverageCohort,
  recentlyViewedCohort,
  rewritePendingOperation,
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
// a takeover can race a worker's claim or another visitor's takeover; after this many misses they ask again
const takeoverAttempts = 3

/**
 * What a visitor does about the refresh already holding their player:
 * - attach: it covers their sections, so they wait on it as it is
 * - take-over: it's queued without one of their sections, so it becomes theirs and takes those on
 * - ask-again: it's running, or another visitor is still being admitted for it, without one of their sections
 */
export type VisitorFit =
  | { action: 'attach' }
  | { action: 'take-over'; workClass: WorkClass; payload: InteractivePlayerRefreshPayload }
  | { action: 'ask-again' }

export type ActiveRefreshForVisitor = ActiveOperation & { fit: VisitorFit['action'] }

export type VisitorTakeover = { outcome: 'attached'; operationId: string } | { outcome: 'busy' } | { outcome: 'none' }

function readPayload(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
}

function readSections(payload: Record<string, unknown>): readonly string[] {
  return Array.isArray(payload.staleSections) ? payload.staleSections : []
}

// a union: a section someone else asked for is never dropped
function joinSections(held: readonly string[], wanted: readonly PlayerRefreshSection[]): PlayerRefreshSection[] {
  return sectionOrder.filter((section) => held.includes(section) || wanted.includes(section))
}

// a visitor's refresh belongs to no cohort, so its dead letters page like any other visitor's
function takenOverPayload(
  payload: Record<string, unknown>,
  isBackgroundCohort: boolean,
  staleSections: PlayerRefreshSection[],
): InteractivePlayerRefreshPayload {
  if (!isBackgroundCohort) return { ...(payload as InteractivePlayerRefreshPayload), staleSections }

  return { brawlhallaId: payload.brawlhallaId as number, staleSections }
}

/** Decides how a visitor needing these sections deals with the refresh already holding their player. */
export function fitForVisitor(
  active: Pick<ActiveOperationDetails, 'workClass' | 'status' | 'payload'>,
  staleSections: readonly PlayerRefreshSection[],
): VisitorFit {
  const payload = readPayload(active.payload)
  const heldSections = readSections(payload)

  if (staleSections.every((section) => heldSections.includes(section))) return { action: 'attach' }

  if (active.status !== 'pending') return { action: 'ask-again' }

  const isBackgroundCohort = active.workClass === 'primary-monitoring' && backgroundCohorts.includes(payload.cohort)

  return {
    action: 'take-over',
    workClass: isBackgroundCohort ? 'interactive' : active.workClass,
    payload: takenOverPayload(payload, isBackgroundCohort, joinSections(heldSections, staleSections)),
  }
}

function readActivePlayerRefresh(database: Database, brawlhallaId: number, dedupeKey?: string) {
  return findActiveOperationDetails(database, {
    kind: playerRefreshKind,
    resourceKey: `player:${brawlhallaId}`,
    dedupeKey,
  })
}

/** The refresh holding the player, by player or dedupe key, with how a visitor needing these sections deals with it. */
export async function findActiveRefreshForVisitor(
  database: Database,
  input: { dedupeKey: string; brawlhallaId: number; staleSections: readonly PlayerRefreshSection[] },
): Promise<ActiveRefreshForVisitor | null> {
  const active = await readActivePlayerRefresh(database, input.brawlhallaId, input.dedupeKey)

  if (!active) return null

  return {
    operationId: active.operationId,
    awaitingAdmission: active.awaitingAdmission,
    reservationExpired: active.reservationExpired,
    fit: fitForVisitor(active, input.staleSections).action,
  }
}

/**
 * Makes the player's queued refresh cover the visitor: it takes on their sections, and a background one becomes
 * interactive work. Only for a visitor who passed verification and admission. Each write checks the payload it built
 * on is still there, so two visitors taking over at once both get their sections.
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

    if (fit.action === 'ask-again') return { outcome: 'busy' }

    const isRewritten = await rewritePendingOperation(database, {
      job: interactivePlayerRefreshContract,
      operationId: active.operationId,
      expectedPayload: active.payload,
      workClass: fit.workClass,
      payload: fit.payload,
    })

    if (isRewritten) return { outcome: 'attached', operationId: active.operationId }
  }

  return { outcome: 'busy' }
}
