import type { Database } from '@brawltome/foundation'
import { and, eq, gt, inArray, lte, type SQL, sql } from 'drizzle-orm'
import type { OperationKind } from '../domain/operation-kinds'
import type { TransitionResult } from '../model'
import { deadLetterReservation, reservationExpiredFailure, reservationFailure } from './reservation-failure'
import { operations } from './tables'
import type { Transaction } from './transaction'
import { notifyWakeup } from './wakeup'

// leaves the kind out of the match when the caller does not narrow it
function ofKinds(kinds: readonly OperationKind[] | undefined): SQL | undefined {
  return kinds ? inArray(operations.kind, kinds) : undefined
}

async function makePending(transaction: Transaction, operationId: string, conditions: (SQL | undefined)[]) {
  const [updated] = await transaction
    .update(operations)
    .set({ status: 'pending', reservationToken: null, reservationExpiresAt: null, updatedAt: sql`clock_timestamp()` })
    .where(and(eq(operations.id, operationId), ...conditions))
    .returning({ id: operations.id })

  return updated !== undefined
}

export type ActivateReservedInput = {
  operationId: string
  reservationToken: string
  kinds: readonly OperationKind[]
}

/** Queues a reservation the caller still holds: the token matches and it has not expired. */
export function activateReserved(database: Database, input: ActivateReservedInput): Promise<TransitionResult> {
  return database.db.transaction(async (transaction) => {
    const activated = await makePending(transaction, input.operationId, [
      ofKinds(input.kinds),
      eq(operations.status, 'awaiting_admission'),
      eq(operations.reservationToken, input.reservationToken),
      gt(operations.reservationExpiresAt, sql`clock_timestamp()`),
    ])

    if (!activated) return 'lease-lost' as const

    await notifyWakeup(transaction, input.operationId)

    return 'transitioned' as const
  })
}

export type ActivateAdmittedInput = { operationId: string; kinds: readonly OperationKind[] }

/** Queues an awaiting_admission operation without checking its token, for a caller that admitted it itself. */
export function activateAdmitted(database: Database, input: ActivateAdmittedInput): Promise<TransitionResult> {
  return database.db.transaction(async (transaction) => {
    const activated = await makePending(transaction, input.operationId, [
      ofKinds(input.kinds),
      eq(operations.status, 'awaiting_admission'),
    ])

    if (!activated) return 'lease-lost' as const

    await notifyWakeup(transaction, input.operationId)

    return 'transitioned' as const
  })
}

export type RejectReservedInput = {
  operationId: string
  reservationToken: string
  reason: string
  message: string
  kinds: readonly OperationKind[]
}

/** Sends a reservation the caller holds to dead letter, with the reason as its error code. */
export async function rejectReserved(database: Database, input: RejectReservedInput): Promise<TransitionResult> {
  const [rejected] = await database.db
    .update(operations)
    .set(deadLetterReservation(reservationFailure(input.reason, input.message)))
    .where(
      and(
        eq(operations.id, input.operationId),
        ofKinds(input.kinds),
        eq(operations.status, 'awaiting_admission'),
        eq(operations.reservationToken, input.reservationToken),
      ),
    )
    .returning({ id: operations.id })

  return rejected ? 'transitioned' : 'lease-lost'
}

export type RejectExpiredInput = { operationId: string; kinds: readonly OperationKind[] }

/** Sends a reservation whose time ran out to dead letter. */
export async function rejectExpired(database: Database, input: RejectExpiredInput): Promise<TransitionResult> {
  const [rejected] = await database.db
    .update(operations)
    .set(deadLetterReservation(reservationExpiredFailure))
    .where(
      and(
        eq(operations.id, input.operationId),
        ofKinds(input.kinds),
        eq(operations.status, 'awaiting_admission'),
        lte(operations.reservationExpiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({ id: operations.id })

  return rejected ? 'transitioned' : 'lease-lost'
}

const boundStatuses = ['pending', 'leased', 'succeeded']

export type ActivateBoundOptions = { kinds?: readonly OperationKind[] }

/** Queues an awaiting_binding operation; one already queued, running or done counts as activated. */
export function activateBound(
  database: Database,
  operationId: string,
  options: ActivateBoundOptions = {},
): Promise<TransitionResult> {
  return database.db.transaction(async (transaction) => {
    const kindMatches = ofKinds(options.kinds)

    const activated = await makePending(transaction, operationId, [
      kindMatches,
      eq(operations.status, 'awaiting_binding'),
    ])

    if (activated) {
      await notifyWakeup(transaction, operationId)

      return 'transitioned' as const
    }

    const [existing] = await transaction
      .select({ status: operations.status })
      .from(operations)
      .where(and(eq(operations.id, operationId), kindMatches))

    return existing && boundStatuses.includes(existing.status) ? ('transitioned' as const) : ('lease-lost' as const)
  })
}
