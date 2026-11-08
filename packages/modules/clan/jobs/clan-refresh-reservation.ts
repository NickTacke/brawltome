import type { Database } from '@brawltome/foundation'
import {
  type ActiveOperation,
  activateReserved,
  findActiveOperation,
  interactiveRefreshMaxAttempts,
  type OperationProvenance,
  type ReserveInteractiveRefreshResult,
  rejectReserved,
  reserveForAdmission,
  type TransitionResult,
} from '@brawltome/refresh-operations'
import type { ClanRefreshSection } from '../domain/refresh-section'

const clanRefreshKinds = ['clan-refresh'] as const

export type ClanRefreshReservation = {
  dedupeKey: string
  operationKey: string
  clanId: number
  staleSections: ClanRefreshSection[]
  provenance: OperationProvenance
  reservationTtlSeconds: number
}

export function findActiveClanRefresh(database: Database, dedupeKey: string): Promise<ActiveOperation | null> {
  return findActiveOperation(database, { kind: 'clan-refresh', dedupeKey })
}

export function reserveClanRefresh(
  database: Database,
  input: ClanRefreshReservation,
): Promise<ReserveInteractiveRefreshResult> {
  return reserveForAdmission(database, {
    kind: 'clan-refresh',
    dedupeKey: input.dedupeKey,
    operationKey: input.operationKey,
    workClass: 'interactive',
    payload: { clanId: input.clanId, staleSections: input.staleSections },
    provenance: input.provenance,
    maxAttempts: interactiveRefreshMaxAttempts,
    reservationTtlSeconds: input.reservationTtlSeconds,
  })
}

export function activateClanRefresh(
  database: Database,
  operationId: string,
  reservationToken: string,
): Promise<TransitionResult> {
  return activateReserved(database, { operationId, reservationToken, kinds: clanRefreshKinds })
}

export function rejectClanRefresh(
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
    kinds: clanRefreshKinds,
  })
}

/** The reservation use cases bound to one database, for the API context. */
export function createClanRefreshReservations(database: Database) {
  return {
    findActiveClanRefresh: (dedupeKey: string) => findActiveClanRefresh(database, dedupeKey),

    reserveClanRefresh: (input: ClanRefreshReservation) => reserveClanRefresh(database, input),

    activateClanRefresh: (operationId: string, reservationToken: string) =>
      activateClanRefresh(database, operationId, reservationToken),

    rejectClanRefresh: (operationId: string, reservationToken: string, reason: string) =>
      rejectClanRefresh(database, operationId, reservationToken, reason),
  }
}

export type ClanRefreshReservations = ReturnType<typeof createClanRefreshReservations>
