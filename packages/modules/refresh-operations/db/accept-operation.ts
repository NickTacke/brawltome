import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { OperationKind } from '../domain/operation-kinds'
import type { AcceptOperationResult, OperationLease, OperationProvenance, WorkClass } from '../model'
import { readActiveOperation } from './find-operations'
import { operations } from './tables'
import type { Transaction } from './transaction'
import { notifyWakeup } from './wakeup'

const defaultMaxAttempts = 3

// an operation with a resource conflicts with any unique index, including the one allowing one active operation per
// resource; one without conflicts only on its dedupe key
function conflictTarget(input: AcceptOperationInput) {
  if (input.resourceKey !== undefined) return undefined

  return {
    target: [operations.kind, operations.dedupeKey],
    where: sql`status IN ('pending', 'leased')`,
  }
}

async function readHolder(transaction: Transaction, input: AcceptOperationInput): Promise<string | null> {
  if (input.resourceKey !== undefined) {
    const holder = await readActiveOperation(transaction, input)

    return holder?.operationId ?? null
  }

  const [active] = await transaction
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.kind, input.kind),
        eq(operations.dedupeKey, input.dedupeKey),
        inArray(operations.status, ['pending', 'leased']),
      ),
    )

  return active?.id ?? null
}

export type AcceptOperationInput = {
  kind: OperationKind
  dedupeKey: string
  operationKey: string
  // when present the operation holds this resource, and any active operation on it stands in for this one
  resourceKey?: string
  workClass: WorkClass
  payload: OperationLease['payload']
  provenance: OperationProvenance
  maxAttempts?: number
}

/** Queues an operation as pending, or reports the pending or leased one that already holds this dedupe key. */
export async function acceptOperation(database: Database, input: AcceptOperationInput): Promise<AcceptOperationResult> {
  for (;;) {
    const result = await database.db.transaction(async (transaction) => {
      const operationId = randomUUID()

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
          maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
        })
        .onConflictDoNothing(conflictTarget(input))
        .returning({ id: operations.id })

      if (inserted) {
        await notifyWakeup(transaction, operationId)

        return { outcome: 'accepted' as const, operationId }
      }

      const activeOperationId = await readHolder(transaction, input)

      return activeOperationId ? { outcome: 'already-active' as const, operationId: activeOperationId } : null
    })

    // the holder finished between the failed insert and the lookup, so try the insert again
    if (result) return result
  }
}
