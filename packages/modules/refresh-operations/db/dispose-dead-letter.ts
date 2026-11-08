import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, eq } from 'drizzle-orm'
import { toDispositionResult, validateDispositionInput } from '../domain/dead-letter-disposition'
import { isStatisticsCollectionKind } from '../domain/operation-kinds'
import type { DeadLetterDisposition, DeadLetterDispositionInput, DeadLetterDispositionResult } from '../model'
import { deadLetterActions, operations, statisticsCollectionSeals } from './tables'
import type { Transaction } from './transaction'
import { notifyWakeup } from './wakeup'

export type DeadLetterDisposalInput = DeadLetterDispositionInput & { disposition: DeadLetterDisposition }

async function lockDeadLetter(transaction: Transaction, operationId: string) {
  const [target] = await transaction
    .select({
      id: operations.id,
      effectOperationId: operations.effectOperationId,
      kind: operations.kind,
      dedupeKey: operations.dedupeKey,
      operationKey: operations.operationKey,
      resourceKey: operations.resourceKey,
      workClass: operations.workClass,
      payloadVersion: operations.payloadVersion,
      payload: operations.payload,
      provenance: operations.provenance,
      maxAttempts: operations.maxAttempts,
      leaseToken: operations.leaseToken,
      originScheduleOccurrenceId: operations.originScheduleOccurrenceId,
    })
    .from(operations)
    .where(and(eq(operations.id, operationId), eq(operations.status, 'dead_letter')))
    .for('update')

  return target
}

type LockedDeadLetter = NonNullable<Awaited<ReturnType<typeof lockDeadLetter>>>

// a publication that read the collection has sealed it, and replaying it would change what that publication read
async function requireCollectionUnsealed(transaction: Transaction, target: LockedDeadLetter): Promise<void> {
  if (!isStatisticsCollectionKind(target.kind)) return

  await transaction
    .select({ id: operations.id })
    .from(operations)
    .where(eq(operations.id, target.effectOperationId))
    .for('update')

  const [seal] = await transaction
    .select({ collectionOperationId: statisticsCollectionSeals.collectionOperationId })
    .from(statisticsCollectionSeals)
    .where(eq(statisticsCollectionSeals.collectionOperationId, target.effectOperationId))

  if (seal) throw new Error('Statistics collection replay is sealed by publication validation')
}

async function insertReplay(transaction: Transaction, target: LockedDeadLetter, actionId: string): Promise<string> {
  const replayOperationId = randomUUID()

  await transaction.insert(operations).values({
    id: replayOperationId,
    effectOperationId: target.effectOperationId,
    kind: target.kind,
    dedupeKey: `${target.dedupeKey}:replay:${actionId}`,
    operationKey: target.operationKey,
    resourceKey: target.resourceKey,
    workClass: target.workClass,
    payloadVersion: target.payloadVersion,
    payload: target.payload,
    provenance: target.provenance,
    maxAttempts: target.maxAttempts,
    leaseToken: target.leaseToken,
    replayedFromOperationId: target.id,
    originScheduleOccurrenceId: target.originScheduleOccurrenceId,
  })

  return replayOperationId
}

type Disposal = { disposition: DeadLetterDisposition; actorId: string; reason: string }

async function disposeLockedDeadLetter(
  transaction: Transaction,
  target: LockedDeadLetter,
  { disposition, actorId, reason }: Disposal,
): Promise<DeadLetterDispositionResult> {
  const [existing] = await transaction
    .select()
    .from(deadLetterActions)
    .where(eq(deadLetterActions.targetOperationId, target.id))

  if (existing) return toDispositionResult(existing)

  const actionId = randomUUID()
  const replayOperationId = disposition === 'replayed' ? await insertReplay(transaction, target, actionId) : null

  await transaction.insert(deadLetterActions).values({
    id: actionId,
    targetOperationId: target.id,
    disposition,
    actorId,
    reason,
    replayOperationId,
  })

  if (!replayOperationId) return { outcome: 'discarded', disposition: 'discarded', actionId, replayOperationId: null }

  await notifyWakeup(transaction, replayOperationId)

  return { outcome: 'replayed', disposition: 'replayed', actionId, replayOperationId }
}

/** Records that an operator replayed or discarded a dead letter; a replay queues a fresh copy of the operation. */
export async function disposeDeadLetter(
  database: Database,
  input: DeadLetterDisposalInput,
): Promise<DeadLetterDispositionResult> {
  // checked before the transaction starts, so a bad input never takes a lock
  const { actorId, reason } = validateDispositionInput(input)

  return database.db.transaction(async (transaction) => {
    const target = await lockDeadLetter(transaction, input.operationId)

    if (!target) return { outcome: 'not-found', disposition: null, actionId: null, replayOperationId: null }

    await requireCollectionUnsealed(transaction, target)

    return disposeLockedDeadLetter(transaction, target, { disposition: input.disposition, actorId, reason })
  })
}
