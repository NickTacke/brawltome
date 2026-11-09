import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { eq, sql } from 'drizzle-orm'
import { validateSchedule } from '../domain/schedule-definition'
import type { JobContract } from '../jobs/job-definition'
import { assertValidJobInput } from '../jobs/job-input'
import type {
  CreateLeaderboardDeepCrawlSchedule,
  CreateLeaderboardSchedule,
  CreateRankingRetentionSchedule,
  CreateScheduleResult,
} from '../model'
import { type ScheduleDefinition, scheduleDefinitionMatches } from './schedule-definition-matches'
import { lockScheduleKey } from './schedule-lock'
import { schedules } from './tables'
import type { Transaction } from './transaction'

export type FixedSchedule =
  | CreateLeaderboardSchedule
  | CreateRankingRetentionSchedule
  | CreateLeaderboardDeepCrawlSchedule

export type ReconcileFixedScheduleInput = {
  job: JobContract<unknown>
  schedule: FixedSchedule
  // worker configuration owns the enabled flag of some schedules: reconciling turns a paused one back on
  reenable?: boolean
}

const defaultMaxAttempts = 3

async function enableSchedule(transaction: Transaction, scheduleId: string): Promise<void> {
  await transaction
    .update(schedules)
    .set({ enabled: true, updatedAt: sql`clock_timestamp()` })
    .where(eq(schedules.id, scheduleId))
}

async function retireSchedule(transaction: Transaction, scheduleId: string): Promise<void> {
  await transaction
    .update(schedules)
    .set({
      enabled: false,
      scheduleKey: sql`${schedules.scheduleKey} || ':retired:' || ${schedules.id}::text`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(schedules.id, scheduleId))
}

async function insertSchedule(
  transaction: Transaction,
  scheduleKey: string,
  definition: ScheduleDefinition,
): Promise<string> {
  const scheduleId = randomUUID()

  await transaction
    .insert(schedules)
    .values({ id: scheduleId, scheduleKey, nextDueAt: definition.firstDueAt, ...definition })

  return scheduleId
}

/**
 * Fixed schedules are owned by worker configuration: a changed definition retires the old schedule and starts a new
 * one under the same key instead of rewriting history.
 */
export async function reconcileFixedSchedule(
  database: Database,
  { job, schedule, reenable = false }: ReconcileFixedScheduleInput,
): Promise<CreateScheduleResult> {
  assertValidJobInput(job, schedule.workClass, schedule.payload)

  const firstDueAt = validateSchedule(schedule)

  const definition: ScheduleDefinition = {
    kind: schedule.kind,
    workClass: schedule.workClass,
    intervalMs: schedule.intervalMs,
    firstDueAt,
    operationKeyPrefix: schedule.operationKeyPrefix,
    payload: schedule.payload,
    provenance: schedule.provenance,
    maxAttempts: schedule.maxAttempts ?? defaultMaxAttempts,
  }

  return database.db.transaction(async (transaction) => {
    await lockScheduleKey(transaction, schedule.scheduleKey)

    const [existing] = await transaction
      .select({
        id: schedules.id,
        enabled: schedules.enabled,
        matches: sql<boolean>`${scheduleDefinitionMatches(definition)}`,
      })
      .from(schedules)
      .where(eq(schedules.scheduleKey, schedule.scheduleKey))
      .for('update')

    if (existing?.matches && reenable && !existing.enabled) {
      await enableSchedule(transaction, existing.id)

      return { outcome: 'reconciled' as const, scheduleId: existing.id }
    }

    if (existing?.matches) return { outcome: 'already-exists' as const, scheduleId: existing.id }

    if (existing) await retireSchedule(transaction, existing.id)

    const scheduleId = await insertSchedule(transaction, schedule.scheduleKey, definition)

    return { outcome: existing ? ('reconciled' as const) : ('created' as const), scheduleId }
  })
}
