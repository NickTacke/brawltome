import type { Database } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { operations, scheduleOccurrences, schedules } from './tables'

/** A schedule with each of its occurrences and the state of the operation each one produced. */
export async function inspectSchedule(database: Database, scheduleId: string) {
  const [schedule] = await database.db.execute<postgres.Row>(sql`
    SELECT * FROM ${schedules} WHERE ${schedules.id} = ${scheduleId}
  `)

  const occurrences = await database.db.execute<postgres.Row>(sql`
    SELECT occurrence.*, coalesce(operation.status, deduplicated.status) AS operation_status,
           coalesce(operation.attempt_count, deduplicated.attempt_count) AS attempt_count,
           coalesce(operation.last_error, deduplicated.last_error) AS last_error,
           coalesce(operation.completed_at, deduplicated.completed_at) AS completed_at
    FROM ${scheduleOccurrences} occurrence
    LEFT JOIN ${operations} operation ON operation.id = occurrence.operation_id
    LEFT JOIN ${operations} deduplicated ON deduplicated.id = occurrence.deduplicated_to_operation_id
    WHERE occurrence.schedule_id = ${scheduleId}
    ORDER BY occurrence.window_due_at
  `)

  return { schedule, occurrences }
}
