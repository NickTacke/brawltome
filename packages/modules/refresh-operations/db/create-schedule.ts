import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { validateSchedule } from '../domain/schedule-definition'
import type { CreateSchedule, CreateScheduleResult } from '../model'
import { type ScheduleDefinition, scheduleDefinitionMatches } from './schedule-definition-matches'
import { schedules } from './tables'

const defaultMaxAttempts = 3

/** Adds a schedule, or reports the existing one when the same key already holds the same definition. */
export async function createSchedule(database: Database, input: CreateSchedule): Promise<CreateScheduleResult> {
  const firstDueAt = validateSchedule(input)

  const definition: ScheduleDefinition = {
    kind: input.kind ?? 'proof',
    workClass: input.workClass,
    intervalMs: input.intervalMs,
    firstDueAt,
    operationKeyPrefix: input.operationKeyPrefix,
    payload: input.payload,
    provenance: input.provenance,
    maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
  }

  const [created] = await database.db
    .insert(schedules)
    .values({ id: randomUUID(), scheduleKey: input.scheduleKey, nextDueAt: firstDueAt, ...definition })
    .onConflictDoNothing({ target: schedules.scheduleKey })
    .returning({ id: schedules.id })

  if (created) return { outcome: 'created', scheduleId: created.id }

  const [existing] = await database.db
    .select({
      id: schedules.id,
      matches: sql<boolean>`${and(isNull(schedules.resourceKey), scheduleDefinitionMatches(definition))}`,
    })
    .from(schedules)
    .where(eq(schedules.scheduleKey, input.scheduleKey))

  if (!existing?.matches) throw new Error(`scheduleKey ${input.scheduleKey} already has a different definition`)

  return { outcome: 'already-exists', scheduleId: existing.id }
}
