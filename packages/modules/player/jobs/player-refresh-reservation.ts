import type { Database } from '@brawltome/foundation'
import {
  type ActiveOperation,
  activateAdmitted,
  activateReserved,
  findActiveOperation,
  interactiveRefreshMaxAttempts,
  type OperationProvenance,
  promotePendingWorkClass,
  type ReserveInteractiveRefreshResult,
  recentlyViewedCohort,
  rejectExpired,
  rejectReserved,
  reserveForAdmission,
  type TransitionResult,
} from '@brawltome/queue'
import { interactivePlayerRefreshContract } from './interactive-player-refresh-contract'

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

  return reserveForAdmission(database, reservation, {
    // a visitor outranks the background: a queued recently viewed refresh for this player becomes interactive
    // work, so the visitor waits on interactive priority instead of behind the monitoring queue
    beforeInsert: (transaction) =>
      promotePendingWorkClass(transaction, {
        kind: 'interactive-player-refresh',
        resourceKey,
        from: 'primary-monitoring',
        to: 'interactive',
        payloadEquals: { cohort: recentlyViewedCohort },
      }),
  })
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
    findActiveInteractivePlayerRefresh: (dedupeKey: string, brawlhallaId?: number) =>
      findActiveInteractivePlayerRefresh(database, dedupeKey, brawlhallaId),

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
