import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { OperationKind } from '../domain/operation-kinds'
import type {
  AcceptOperationResult,
  OperationLease,
  OperationProvenance,
  ReserveInteractiveRefreshResult,
  WorkClass,
} from '../model'
import { readActiveOperation } from './find-operations'
import { deadLetterReservation, reservationExpiredFailure } from './reservation-failure'
import { operations } from './tables'
import type { Transaction } from './transaction'

const defaultMaxAttempts = 3

export type ReserveForAdmissionInput = {
  kind: OperationKind
  dedupeKey: string
  operationKey: string
  // when present the operation holds this resource, and any active operation on it blocks the reservation
  resourceKey?: string
  workClass: WorkClass
  payload: OperationLease['payload']
  provenance: OperationProvenance
  maxAttempts: number
  reservationTtlSeconds: number
}

export type ReserveForAdmissionOptions = {
  // runs after overdue reservations expire and before the insert, in the same transaction
  beforeInsert?: (transaction: Transaction) => Promise<void>
}

/** Holds a place in the queue as awaiting_admission until the caller activates or rejects it with the token. */
export async function reserveForAdmission(
  database: Database,
  input: ReserveForAdmissionInput,
  options: ReserveForAdmissionOptions = {},
): Promise<ReserveInteractiveRefreshResult> {
  for (;;) {
    const result = await database.db.transaction(async (transaction) => {
      await expireOverdueReservations(transaction, input)
      await options.beforeInsert?.(transaction)

      return insertReservation(transaction, input)
    })

    // the holder finished between the failed insert and the lookup, so try the insert again
    if (result) return result
  }
}

async function expireOverdueReservations(transaction: Transaction, input: ReserveForAdmissionInput): Promise<void> {
  await transaction
    .update(operations)
    .set(deadLetterReservation(reservationExpiredFailure))
    .where(
      and(
        eq(operations.kind, input.kind),
        eq(operations.dedupeKey, input.dedupeKey),
        eq(operations.status, 'awaiting_admission'),
        lte(operations.reservationExpiresAt, sql`clock_timestamp()`),
      ),
    )
}

// an operation with a resource conflicts with any unique index, including the one allowing one active operation per
// resource; one without conflicts only on its dedupe key
function conflictTarget(input: ReserveForAdmissionInput) {
  if (input.resourceKey !== undefined) return undefined

  return {
    target: [operations.kind, operations.dedupeKey],
    where: sql`status IN ('awaiting_admission', 'pending', 'leased')`,
  }
}

async function insertReservation(
  transaction: Transaction,
  input: ReserveForAdmissionInput,
): Promise<ReserveInteractiveRefreshResult | null> {
  const operationId = randomUUID()
  const reservationToken = randomUUID()

  const [inserted] = await transaction
    .insert(operations)
    .values({
      id: operationId,
      effectOperationId: operationId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      operationKey: input.operationKey,
      resourceKey: input.resourceKey,
      workClass: input.workClass,
      payload: input.payload,
      provenance: input.provenance,
      status: 'awaiting_admission',
      maxAttempts: input.maxAttempts,
      reservationToken,
      reservationExpiresAt: sql`clock_timestamp() + (${input.reservationTtlSeconds} * interval '1 second')`,
    })
    .onConflictDoNothing(conflictTarget(input))
    .returning({ id: operations.id })

  if (inserted) return { outcome: 'reserved', operationId, reservationToken }

  const active = await readActiveOperation(transaction, input)

  return active ? { outcome: 'already-active', operationId: active.operationId } : null
}

export type ReserveForBindingInput = {
  kind: OperationKind
  // every kind whose operations share this stable operation key; defaults to the kind alone
  operationKeyKinds?: readonly OperationKind[]
  // second argument of the advisory lock taken on the operation key, so kinds do not block each other
  lockNamespace: number
  dedupeKey: string
  operationKey: string
  workClass: WorkClass
  payload: OperationLease['payload']
  provenance: OperationProvenance
  maxAttempts?: number
  // thrown when the operation key already holds a different definition
  mismatchMessage: string
}

/** Reserves an operation as awaiting_binding, one per stable operation key, until its owner activates it. */
export async function reserveForBinding(
  database: Database,
  input: ReserveForBindingInput,
): Promise<AcceptOperationResult> {
  return database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationKey}, ${input.lockNamespace}))`,
    )

    const existing = await readBoundDefinition(transaction, input)

    if (existing) {
      if (!existing.matches) throw new Error(input.mismatchMessage)

      return { outcome: 'already-active' as const, operationId: existing.id }
    }

    const operationId = randomUUID()

    await transaction.insert(operations).values({
      id: operationId,
      effectOperationId: operationId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      operationKey: input.operationKey,
      workClass: input.workClass,
      payload: input.payload,
      provenance: input.provenance,
      maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
      status: 'awaiting_binding',
    })

    return { outcome: 'accepted' as const, operationId }
  })
}

// the original operation holding this key, locked, and whether it was reserved with this same definition
async function readBoundDefinition(transaction: Transaction, input: ReserveForBindingInput) {
  const sameDefinition = and(
    eq(operations.kind, input.kind),
    eq(operations.dedupeKey, input.dedupeKey),
    eq(operations.workClass, input.workClass),
    eq(operations.payload, input.payload),
    eq(operations.provenance, input.provenance),
    eq(operations.maxAttempts, input.maxAttempts ?? defaultMaxAttempts),
  )

  const [existing] = await transaction
    .select({ id: operations.id, matches: sql<boolean>`${sameDefinition}` })
    .from(operations)
    .where(
      and(
        eq(operations.operationKey, input.operationKey),
        inArray(operations.kind, input.operationKeyKinds ?? [input.kind]),
        isNull(operations.replayedFromOperationId),
      ),
    )
    .for('update')

  return existing
}
