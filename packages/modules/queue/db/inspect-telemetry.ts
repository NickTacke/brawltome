import type { Database } from '@brawltome/foundation'
import { and, eq, lte, sql } from 'drizzle-orm'
import { buildTelemetrySnapshot } from '../domain/queue-telemetry'
import {
  admissionRejectionCodes,
  type DeadLetterReason,
  type OperationsTelemetrySnapshot,
  type WorkClass,
} from '../model'
import { deadLetterActions, operations, schedules } from './tables'

type Count = string | number

async function readDatabaseTime(database: Database): Promise<Date> {
  const [row] = await database.db.execute<{ observed_at: Date }>(sql`SELECT clock_timestamp() AS observed_at`)

  return row.observed_at
}

// waiting time since the work last became runnable: a deep crawl that yields between slices is created once but
// becomes runnable again after every slice, and must not look like one job stuck for the whole crawl
async function readOldestPending(database: Database, observedAt: Date) {
  const ageMs = sql<Count>`greatest(0, extract(epoch FROM (${observedAt}::timestamptz - min(${operations.availableAt}))) * 1000)::bigint`

  const rows = await database.db
    .select({ workClass: operations.workClass, ageMs })
    .from(operations)
    .where(and(eq(operations.status, 'pending'), lte(operations.availableAt, observedAt)))
    .groupBy(operations.workClass)

  return rows.map((row) => ({ workClass: row.workClass, ageMs: Number(row.ageMs) }))
}

// a dead letter nobody disposed of yet; admission rejections are expected outcomes, so they count apart
async function readDeadLetterCounts(database: Database) {
  const rejectionCodes = sql.join(
    admissionRejectionCodes.map((code) => sql`${code}`),
    sql`, `,
  )

  const rows = await database.db.execute<{
    work_class: WorkClass
    kind: string
    reason: DeadLetterReason
    count: Count
  }>(sql`
    SELECT operation.work_class, operation.kind,
           CASE WHEN operation.last_error ->> 'code' IN (${rejectionCodes})
             THEN 'admission_rejected' ELSE 'execution' END AS reason,
           count(*)::bigint AS count
    FROM ${operations} AS operation
    WHERE operation.status = 'dead_letter'
      AND NOT EXISTS (
        SELECT 1
        FROM ${deadLetterActions} AS action
        WHERE action.target_operation_id = operation.id
      )
    GROUP BY 1, 2, 3
  `)

  return rows.map((row) => ({
    workClass: row.work_class,
    kind: row.kind,
    reason: row.reason,
    count: Number(row.count),
  }))
}

async function readScheduleLateness(database: Database, observedAt: Date) {
  const latenessMs = sql<Count>`greatest(0, extract(epoch FROM (${observedAt}::timestamptz - min(${schedules.nextDueAt}))) * 1000)::bigint`

  const rows = await database.db
    .select({ kind: schedules.kind, latenessMs })
    .from(schedules)
    .where(eq(schedules.enabled, true))
    .groupBy(schedules.kind)

  return rows.map((row) => ({ kind: row.kind, latenessMs: Number(row.latenessMs) }))
}

/** How long work has waited, how many dead letters are open and how late each kind of schedule runs. */
export async function inspectTelemetry(database: Database): Promise<OperationsTelemetrySnapshot> {
  const observedAt = await readDatabaseTime(database)
  const oldestPending = await readOldestPending(database, observedAt)
  const deadLetters = await readDeadLetterCounts(database)
  const scheduleLateness = await readScheduleLateness(database, observedAt)

  return buildTelemetrySnapshot({ observedAt, oldestPending, deadLetters, scheduleLateness })
}
