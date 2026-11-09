import { and, eq, type SQL } from 'drizzle-orm'
import type { OperationLease, OperationProvenance, WorkClass } from '../model'
import { schedules } from './tables'

export type ScheduleDefinition = {
  kind: string
  workClass: WorkClass
  intervalMs: number
  firstDueAt: Date
  operationKeyPrefix: string
  payload: OperationLease['payload']
  provenance: OperationProvenance
  maxAttempts: number
}

/** Whether a stored schedule was defined exactly like this; json is compared as jsonb, so key order does not matter. */
export function scheduleDefinitionMatches(definition: ScheduleDefinition): SQL | undefined {
  return and(
    eq(schedules.kind, definition.kind),
    eq(schedules.workClass, definition.workClass),
    eq(schedules.intervalMs, definition.intervalMs),
    eq(schedules.firstDueAt, definition.firstDueAt),
    eq(schedules.operationKeyPrefix, definition.operationKeyPrefix),
    eq(schedules.payload, definition.payload),
    eq(schedules.provenance, definition.provenance),
    eq(schedules.maxAttempts, definition.maxAttempts),
  )
}
