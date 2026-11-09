import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { isLeaderboardKind } from '../domain/operation-kinds'
import { type DueWindows, describeDueWindows, scheduledDedupeKey } from '../domain/schedule-windows'
import type { MaterializeSchedulesResult } from '../model'
import { operations, scheduleOccurrences, schedules } from './tables'
import type { Transaction } from './transaction'
import { notifyWakeup } from './wakeup'

type Occurrence = MaterializeSchedulesResult['occurrences'][number]

type DueSchedule = Awaited<ReturnType<typeof lockDueSchedules>>[number]

// ranking owns the effect table; run inside the materialize transaction, after the operation rows are locked
export type AppliedLeaderboardEffects = (
  transaction: Transaction,
  effectOperationIds: readonly string[],
) => Promise<ReadonlySet<string>>

const maximumLimit = 1_000

// locked rows are skipped, so two workers materializing at once take different schedules
async function lockDueSchedules(transaction: Transaction, materializedAt: Date, limit: number) {
  const dueWindowCount = sql<string | number>`floor(
    extract(epoch FROM (${materializedAt}::timestamptz - ${schedules.nextDueAt})) * 1000 / ${schedules.intervalMs}
  )::bigint + 1`

  return transaction
    .select({
      id: schedules.id,
      kind: schedules.kind,
      resourceKey: schedules.resourceKey,
      workClass: schedules.workClass,
      nextWindowNumber: schedules.nextWindowNumber,
      nextDueAt: schedules.nextDueAt,
      operationKeyPrefix: schedules.operationKeyPrefix,
      payload: schedules.payload,
      provenance: schedules.provenance,
      maxAttempts: schedules.maxAttempts,
      dueWindowCount,
    })
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextDueAt, materializedAt)))
    .orderBy(asc(schedules.nextDueAt), asc(schedules.id))
    .limit(limit)
    .for('update', { skipLocked: true })
}

async function expireStaleReservations(
  transaction: Transaction,
  resourceKey: string,
  materializedAt: Date,
): Promise<void> {
  await transaction
    .update(operations)
    .set({
      status: 'dead_letter',
      reservationToken: null,
      reservationExpiresAt: null,
      completedAt: materializedAt,
      updatedAt: materializedAt,
      lastError: { code: 'admission_reservation_expired', message: 'Admission reservation expired', retryable: false },
    })
    .where(
      and(
        eq(operations.resourceKey, resourceKey),
        eq(operations.status, 'awaiting_admission'),
        lte(operations.reservationExpiresAt, materializedAt),
      ),
    )
}

type LeaderboardTarget = { id: string; effect_operation_id: string }

// a leaderboard window still queued or running without an effect is discarded when the next window arrives
async function supersedeLeaderboardOperations(
  transaction: Transaction,
  scheduleId: string,
  materializedAt: Date,
  readAppliedEffects: AppliedLeaderboardEffects | undefined,
): Promise<void> {
  if (!readAppliedEffects) {
    throw new Error(
      `supersede leaderboard operations for schedule ${scheduleId}: no applied effect reader was configured`,
    )
  }

  // locked first: a worker recording its effect locks this row before it inserts, so the check below can't go stale
  const lockedOperations = await transaction.execute<LeaderboardTarget>(sql`
    SELECT operation.id, operation.effect_operation_id
    FROM queue.operations operation
    JOIN queue.schedule_occurrences occurrence
      ON occurrence.id = operation.origin_schedule_occurrence_id
    WHERE occurrence.schedule_id = ${scheduleId}
      AND operation.status IN ('pending', 'leased')
    FOR UPDATE OF operation
  `)

  const applied = await readAppliedEffects(
    transaction,
    lockedOperations.map(({ effect_operation_id }) => effect_operation_id),
  )

  const targets = lockedOperations.filter(({ effect_operation_id }) => !applied.has(effect_operation_id))

  if (targets.length === 0) return

  const failure = {
    code: 'superseded_scheduled_operation',
    message: 'A newer scheduled leaderboard window is available',
    retryable: false,
  }

  const failureJson = sql`${JSON.stringify(failure)}::text::jsonb`

  const targetIds = sql.join(
    targets.map(({ id }) => sql`${id}::uuid`),
    sql`, `,
  )

  await transaction.execute(sql`
    WITH targets AS MATERIALIZED (
      SELECT operation.id, operation.attempt_count
      FROM queue.operations operation
      WHERE operation.id IN (${targetIds})
    ), finished_attempts AS (
      UPDATE queue.attempts attempt
      SET finished_at = ${materializedAt}, outcome = 'dead_letter', error = ${failureJson}
      FROM targets
      WHERE attempt.operation_id = targets.id
        AND attempt.attempt_number = targets.attempt_count
        AND attempt.finished_at IS NULL
    ), superseded AS (
      UPDATE queue.operations operation
      SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
          completed_at = ${materializedAt}, updated_at = ${materializedAt},
          last_error = ${failureJson}
      FROM targets
      WHERE operation.id = targets.id
      RETURNING operation.id
    )
    INSERT INTO queue.dead_letter_actions
      (id, target_operation_id, disposition, actor_id, reason)
    SELECT gen_random_uuid(), id, 'discarded', 'schedule-materializer',
           'Superseded by a newer scheduled leaderboard window'
    FROM superseded
    ON CONFLICT (target_operation_id) DO NOTHING
  `)
}

// a player whose ranked and stats sections both finished since the window opened needs no second refresh
async function findCompletedFullRefresh(
  transaction: Transaction,
  schedule: DueSchedule,
  windowDueAt: Date,
): Promise<string | undefined> {
  if (schedule.kind !== 'interactive-player-refresh' || !schedule.resourceKey) return undefined

  const [completed] = await transaction.execute<{ id: string }>(sql`
    SELECT operation.id
    FROM queue.operations operation
    JOIN queue.interactive_refresh_effects effect
      ON effect.operation_id = operation.effect_operation_id
    WHERE operation.resource_key = ${schedule.resourceKey}
      AND operation.status = 'succeeded'
      AND operation.completed_at >= ${windowDueAt}
    GROUP BY operation.id, operation.completed_at
    HAVING bool_or(effect.section = 'ranked' AND effect.completed_at >= ${windowDueAt})
       AND bool_or(effect.section = 'stats' AND effect.completed_at >= ${windowDueAt})
    ORDER BY operation.completed_at DESC, operation.id
    LIMIT 1
  `)

  return completed?.id
}

async function insertScheduledOperation(
  transaction: Transaction,
  schedule: DueSchedule,
  windows: { firstWindowNumber: number },
  materializedAt: Date,
): Promise<string | undefined> {
  const operationId = randomUUID()

  const [inserted] = await transaction
    .insert(operations)
    .values({
      id: operationId,
      effectOperationId: operationId,
      kind: schedule.kind,
      dedupeKey: scheduledDedupeKey(schedule, windows.firstWindowNumber),
      operationKey: `${schedule.operationKeyPrefix}:${schedule.id}:${windows.firstWindowNumber}`,
      resourceKey: schedule.resourceKey,
      workClass: schedule.workClass,
      payload: schedule.payload,
      provenance: schedule.provenance,
      maxAttempts: schedule.maxAttempts,
      availableAt: materializedAt,
    })
    .onConflictDoNothing()
    .returning({ id: operations.id })

  return inserted?.id
}

async function recordOccurrence(
  transaction: Transaction,
  occurrence: {
    id: string
    schedule: DueSchedule
    windows: DueWindows
    windowDueAt: Date
    materializedAt: Date
    operationId: string | undefined
    deduplicatedToOperationId: string | undefined
  },
): Promise<void> {
  const { windows, operationId } = occurrence

  await transaction.insert(scheduleOccurrences).values({
    id: occurrence.id,
    scheduleId: occurrence.schedule.id,
    operationId: operationId ?? null,
    deduplicatedToOperationId: occurrence.deduplicatedToOperationId ?? null,
    disposition: operationId ? 'materialized' : 'deduplicated',
    firstWindowNumber: windows.firstWindowNumber,
    lastWindowNumber: windows.lastWindowNumber,
    windowDueAt: occurrence.windowDueAt,
    materializedAt: occurrence.materializedAt,
    latenessMs: windows.latenessMs,
    missedWindowCount: windows.missedWindowCount,
    catchUp: windows.missedWindowCount > 0,
  })

  if (!operationId) return

  await transaction
    .update(operations)
    .set({ originScheduleOccurrenceId: occurrence.id })
    .where(eq(operations.id, operationId))
}

async function advanceSchedule(
  transaction: Transaction,
  scheduleId: string,
  nextWindowNumber: number,
  materializedAt: Date,
): Promise<void> {
  await transaction
    .update(schedules)
    .set({
      nextWindowNumber,
      nextDueAt: sql`${schedules.firstDueAt} + (${nextWindowNumber} * ${schedules.intervalMs} * interval '1 millisecond')`,
      updatedAt: materializedAt,
    })
    .where(eq(schedules.id, scheduleId))
}

async function materializeSchedule(
  transaction: Transaction,
  schedule: DueSchedule,
  materializedAt: Date,
  readAppliedEffects: AppliedLeaderboardEffects | undefined,
): Promise<Occurrence | null> {
  const windows = describeDueWindows({
    nextWindowNumber: schedule.nextWindowNumber,
    nextDueAt: schedule.nextDueAt,
    dueWindowCount: Number(schedule.dueWindowCount),
    materializedAt,
  })

  const windowDueAt = schedule.nextDueAt
  const occurrenceId = randomUUID()

  if (schedule.resourceKey) await expireStaleReservations(transaction, schedule.resourceKey, materializedAt)

  if (isLeaderboardKind(schedule.kind)) {
    await supersedeLeaderboardOperations(transaction, schedule.id, materializedAt, readAppliedEffects)
  }

  const completedRefreshId = await findCompletedFullRefresh(transaction, schedule, windowDueAt)

  const insertedOperationId = completedRefreshId
    ? undefined
    : await insertScheduledOperation(transaction, schedule, windows, materializedAt)

  const operationId = insertedOperationId ?? completedRefreshId

  if (!operationId) return null

  await recordOccurrence(transaction, {
    id: occurrenceId,
    schedule,
    windows,
    windowDueAt,
    materializedAt,
    operationId: insertedOperationId,
    deduplicatedToOperationId: completedRefreshId,
  })

  await advanceSchedule(transaction, schedule.id, windows.nextWindowNumber, materializedAt)

  if (insertedOperationId) await notifyWakeup(transaction, insertedOperationId)

  return {
    scheduleId: schedule.id,
    occurrenceId,
    operationId,
    kind: schedule.kind,
    workClass: schedule.workClass,
    latenessMs: windows.latenessMs,
    missedWindowCount: windows.missedWindowCount,
  }
}

/**
 * Turns every schedule whose window has come due into an operation, up to the limit. A schedule that is several
 * windows behind gets one operation for the first and counts the rest as missed.
 */
export async function materializeDueSchedules(
  database: Database,
  {
    limit,
    readAppliedLeaderboardEffects,
  }: { limit: number; readAppliedLeaderboardEffects?: AppliedLeaderboardEffects },
): Promise<MaterializeSchedulesResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new Error(`schedule materialization limit must be an integer between 1 and ${maximumLimit}`)
  }

  return database.db.transaction(async (transaction) => {
    const [clock] = await transaction.execute<{ materialized_at: Date }>(
      sql`SELECT clock_timestamp() AS materialized_at`,
    )

    const dueSchedules = await lockDueSchedules(transaction, clock.materialized_at, limit)
    const occurrences: Occurrence[] = []

    for (const schedule of dueSchedules) {
      const occurrence = await materializeSchedule(
        transaction,
        schedule,
        clock.materialized_at,
        readAppliedLeaderboardEffects,
      )

      if (occurrence) occurrences.push(occurrence)
    }

    return { occurrencesCreated: occurrences.length, occurrences }
  })
}
