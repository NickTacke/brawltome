import type { Database } from '@brawltome/foundation'
import { and, asc, eq } from 'drizzle-orm'
import type { DeadLetterInspection } from '../model'
import type { DeadLetterEffects, DeadLetterHooks } from './dead-letter-hooks'
import { deadLetterListColumns, toDeadLetterListItem } from './dead-letter-list-item'
import { readOnlySnapshot } from './read-only-snapshot'
import { attempts, deadLetterActions, operations, scheduleOccurrences, schedules } from './tables'
import type { Transaction } from './transaction'

async function readAttempts(transaction: Transaction, operationId: string): Promise<DeadLetterInspection['attempts']> {
  const rows = await transaction
    .select()
    .from(attempts)
    .where(eq(attempts.operationId, operationId))
    .orderBy(asc(attempts.attemptNumber))

  return rows.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    leaseToken: attempt.leaseToken,
    leaseOwner: attempt.leaseOwner,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    outcome: attempt.outcome,
    error: attempt.error,
  }))
}

async function readOriginSchedule(
  transaction: Transaction,
  operationId: string,
): Promise<DeadLetterInspection['schedule']> {
  const [row] = await transaction
    .select({
      scheduleId: scheduleOccurrences.scheduleId,
      scheduleKey: schedules.scheduleKey,
      firstWindowNumber: scheduleOccurrences.firstWindowNumber,
      lastWindowNumber: scheduleOccurrences.lastWindowNumber,
      windowDueAt: scheduleOccurrences.windowDueAt,
      materializedAt: scheduleOccurrences.materializedAt,
      latenessMs: scheduleOccurrences.latenessMs,
      missedWindowCount: scheduleOccurrences.missedWindowCount,
      catchUp: scheduleOccurrences.catchUp,
    })
    .from(operations)
    .innerJoin(scheduleOccurrences, eq(scheduleOccurrences.id, operations.originScheduleOccurrenceId))
    .innerJoin(schedules, eq(schedules.id, scheduleOccurrences.scheduleId))
    .where(eq(operations.id, operationId))

  if (!row) return null

  return {
    ...row,
    windowDueAt: row.windowDueAt.toISOString(),
    materializedAt: row.materializedAt.toISOString(),
  }
}

async function readAuditActions(
  transaction: Transaction,
  operationId: string,
): Promise<DeadLetterInspection['auditActions']> {
  const rows = await transaction
    .select()
    .from(deadLetterActions)
    .where(eq(deadLetterActions.targetOperationId, operationId))
    .orderBy(asc(deadLetterActions.occurredAt), asc(deadLetterActions.id))

  return rows.map((action) => ({
    actionId: action.id,
    targetOperationId: action.targetOperationId,
    disposition: action.disposition,
    actorId: action.actorId,
    reason: action.reason,
    occurredAt: action.occurredAt.toISOString(),
    replayOperationId: action.replayOperationId,
  }))
}

// an inspection always has these fields; a kind with no describer leaves them empty
const noEffects: DeadLetterEffects = {
  proofEffects: [],
  interactiveEffects: [],
  leaderboardEffects: [],
  statisticsEffects: [],
  statisticsPublicationEffects: [],
}

async function readDeadLetterOperation(transaction: Transaction, operationId: string) {
  const [row] = await transaction
    .select({
      ...deadLetterListColumns,
      effectOperationId: operations.effectOperationId,
      dedupeKey: operations.dedupeKey,
      payloadVersion: operations.payloadVersion,
      payload: operations.payload,
      replayedFromOperationId: operations.replayedFromOperationId,
    })
    .from(operations)
    .leftJoin(deadLetterActions, eq(deadLetterActions.targetOperationId, operations.id))
    .where(and(eq(operations.id, operationId), eq(operations.status, 'dead_letter')))

  return row
}

/** A dead letter with its attempts, the effects it left behind, the schedule window it came from and its audit trail. */
export async function inspectDeadLetter(
  database: Database,
  operationId: string,
  hooks: Pick<DeadLetterHooks, 'describeEffects'>,
): Promise<DeadLetterInspection | null> {
  return database.db.transaction(async (transaction) => {
    const row = await readDeadLetterOperation(transaction, operationId)

    if (!row) return null

    const describeEffects = hooks.describeEffects.get(row.kind)

    const [attemptRows, describedEffects, schedule, auditActions] = await Promise.all([
      readAttempts(transaction, operationId),
      describeEffects ? describeEffects(transaction, row.effectOperationId) : undefined,
      readOriginSchedule(transaction, operationId),
      readAuditActions(transaction, operationId),
    ])

    return {
      operation: {
        ...toDeadLetterListItem(row),
        dedupeKey: row.dedupeKey,
        payload: row.payload,
        payloadVersion: row.payloadVersion,
        replayedFromOperationId: row.replayedFromOperationId,
      },
      attempts: attemptRows,
      ...noEffects,
      ...describedEffects,
      schedule,
      auditActions,
    }
  }, readOnlySnapshot)
}
