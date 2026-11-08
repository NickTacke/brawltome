import type { DeadLetterListItem } from '../model'
import { deadLetterActions, operations } from './tables'

/** The columns of an operation in the dead letter list, with the disposition if someone acted on it. */
export const deadLetterListColumns = {
  operationId: operations.id,
  kind: operations.kind,
  operationKey: operations.operationKey,
  workClass: operations.workClass,
  provenance: operations.provenance,
  attemptCount: operations.attemptCount,
  maxAttempts: operations.maxAttempts,
  lastError: operations.lastError,
  completedAt: operations.completedAt,
  disposition: deadLetterActions.disposition,
}

type DeadLetterListRow = {
  operationId: string
  kind: DeadLetterListItem['kind']
  operationKey: string
  workClass: DeadLetterListItem['workClass']
  provenance: DeadLetterListItem['provenance']
  attemptCount: number
  maxAttempts: number
  lastError: DeadLetterListItem['lastError']
  completedAt: Date | null
  disposition: DeadLetterListItem['disposition']
}

export function toDeadLetterListItem(row: DeadLetterListRow): DeadLetterListItem {
  // the database only lets an operation reach dead_letter with a completion time
  if (!row.completedAt) throw new Error(`read dead letter ${row.operationId}: completion time is missing`)

  return {
    operationId: row.operationId,
    kind: row.kind,
    operationKey: row.operationKey,
    workClass: row.workClass,
    provenance: row.provenance,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    deadLetteredAt: row.completedAt.toISOString(),
    disposition: row.disposition,
  }
}
