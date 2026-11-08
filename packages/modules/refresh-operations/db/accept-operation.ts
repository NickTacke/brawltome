import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { OperationKind } from '../domain/operation-kinds'
import type { AcceptOperationResult, OperationLease, OperationProvenance, WorkClass } from '../model'
import { operations } from './tables'
import { notifyWakeup } from './wakeup'

const defaultMaxAttempts = 3

export type AcceptOperationInput = {
  kind: OperationKind
  dedupeKey: string
  operationKey: string
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
        .onConflictDoNothing({
          target: [operations.kind, operations.dedupeKey],
          where: sql`status IN ('pending', 'leased')`,
        })
        .returning({ id: operations.id })

      if (inserted) {
        await notifyWakeup(transaction, operationId)

        return { outcome: 'accepted' as const, operationId }
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

      return active ? { outcome: 'already-active' as const, operationId: active.id } : null
    })

    // the holder finished between the failed insert and the lookup, so try the insert again
    if (result) return result
  }
}
