import type { Database } from '@brawltome/foundation'
import {
  type ActiveOperation,
  activateAdmitted,
  activateReserved,
  findActiveOperation,
  interactiveRefreshMaxAttempts,
  type OperationProvenance,
  type ReserveInteractiveRefreshResult,
  rejectExpired,
  rejectReserved,
  reserveForAdmission,
  type TransitionResult,
} from '@brawltome/queue'
import { interactivePlayerRefreshContract, type PlayerRefreshSection } from './interactive-player-refresh-contract'
import { findActiveRefreshForVisitor, takeOverPlayerRefresh } from './visitor-refresh-takeover'

const playerRefreshKinds = ['interactive-player-refresh'] as const

export type InteractivePlayerRefreshReservation = {
  dedupeKey: string
  operationKey: string
  brawlhallaId: number
  staleSections: ('ranked' | 'stats')[]
  provenance: OperationProvenance
  reservationTtlSeconds: number
}

function playerResourceKey(brawlhallaId: number): string {
  return `player:${brawlhallaId}`
}

export function findActiveInteractivePlayerRefresh(
  database: Database,
  dedupeKey: string,
  brawlhallaId?: number,
): Promise<ActiveOperation | null> {
  return findActiveOperation(database, {
    kind: 'interactive-player-refresh',
    dedupeKey,
    resourceKey: brawlhallaId ? playerResourceKey(brawlhallaId) : undefined,
  })
}

export function reserveInteractivePlayerRefresh(
  database: Database,
  input: InteractivePlayerRefreshReservation,
): Promise<ReserveInteractiveRefreshResult> {
  const resourceKey = playerResourceKey(input.brawlhallaId)

  const reservation = {
    job: interactivePlayerRefreshContract,
    dedupeKey: input.dedupeKey,
    operationKey: input.operationKey,
    resourceKey,
    workClass: 'interactive' as const,
    payload: { brawlhallaId: input.brawlhallaId, staleSections: input.staleSections },
    provenance: input.provenance,
    maxAttempts: interactiveRefreshMaxAttempts,
    reservationTtlSeconds: input.reservationTtlSeconds,
  }

  // a refresh already holding the player comes back as already-active; the caller takes it over once admitted
  return reserveForAdmission(database, reservation)
}

export function activateInteractivePlayerRefresh(
  database: Database,
  operationId: string,
  reservationToken: string,
): Promise<TransitionResult> {
  return activateReserved(database, { operationId, reservationToken, kinds: playerRefreshKinds })
}

export function activateAdmittedInteractivePlayerRefresh(
  database: Database,
  operationId: string,
): Promise<TransitionResult> {
  return activateAdmitted(database, { operationId, kinds: playerRefreshKinds })
}

export function rejectInteractivePlayerRefresh(
  database: Database,
  operationId: string,
  reservationToken: string,
  reason: string,
): Promise<TransitionResult> {
  return rejectReserved(database, {
    operationId,
    reservationToken,
    reason,
    message: 'Interactive refresh admission rejected',
    kinds: playerRefreshKinds,
  })
}

export function rejectExpiredInteractivePlayerRefresh(
  database: Database,
  operationId: string,
): Promise<TransitionResult> {
  return rejectExpired(database, { operationId, kinds: playerRefreshKinds })
}

/** The reservation use cases bound to one database, for the API context. */
export function createPlayerRefreshReservations(database: Database) {
  return {
    // with how a visitor needing these sections deals with it, so one read answers both
    findActiveInteractivePlayerRefresh: (
      dedupeKey: string,
      brawlhallaId: number,
      staleSections: readonly PlayerRefreshSection[],
    ) => findActiveRefreshForVisitor(database, { dedupeKey, brawlhallaId, staleSections }),

    takeOverPlayerRefresh: (brawlhallaId: number, staleSections: readonly PlayerRefreshSection[]) =>
      takeOverPlayerRefresh(database, { brawlhallaId, staleSections }),

    reserveInteractivePlayerRefresh: (input: InteractivePlayerRefreshReservation) =>
      reserveInteractivePlayerRefresh(database, input),

    activateInteractivePlayerRefresh: (operationId: string, reservationToken: string) =>
      activateInteractivePlayerRefresh(database, operationId, reservationToken),

    activateAdmittedInteractivePlayerRefresh: (operationId: string) =>
      activateAdmittedInteractivePlayerRefresh(database, operationId),

    rejectInteractivePlayerRefresh: (operationId: string, reservationToken: string, reason: string) =>
      rejectInteractivePlayerRefresh(database, operationId, reservationToken, reason),

    rejectExpiredInteractivePlayerRefresh: (operationId: string) =>
      rejectExpiredInteractivePlayerRefresh(database, operationId),
  }
}

export type PlayerRefreshReservations = ReturnType<typeof createPlayerRefreshReservations>
