import { randomUUID } from 'node:crypto'
import type { Database, Sql } from '@brawltome/foundation'
import { validateScheduleIdentity } from '../domain/schedule-definition'
import type { JobContract } from '../jobs/job-definition'
import { assertValidJobInput } from '../jobs/job-input'
import type { OperationProvenance, WorkClass } from '../model'

// one set has been reconciled through this function so far, so it shares primary monitoring's lock
const scheduleSetLockId = 208_192

// the owner of the schedule set keeps when it was last reconciled; both run inside the reconcile transaction
export type ReconcileObservationWatermark = {
  // locks the stored time, so two reconciles of the same snapshot can't both apply
  isSuperseded(sql: Sql, observedAt: Date): Promise<boolean>
  record(sql: Sql, observedAt: Date): Promise<void>
}

export type ResourceSchedule = {
  job: JobContract<unknown>
  scheduleKey: string
  operationKeyPrefix: string
  resourceKey: string
  workClass: WorkClass
  intervalMs: number
  firstDueAt: string
  payload: Record<string, unknown>
  provenance: OperationProvenance
  maxAttempts: number
}

export type ReconcileResourceSchedulesInput = {
  // every enabled schedule with this provenance source belongs to the set
  provenanceSource: string
  // a snapshot no newer than the last one applied changes nothing, so a slow replica can't undo a newer one
  observedAt: Date
  schedules: readonly ResourceSchedule[]
  watermark: ReconcileObservationWatermark
  // payload fields that identify a schedule; a change to one of them replaces it
  identityPayloadFields: readonly string[]
}

export type ReconcileResourceSchedulesResult = {
  created: number
  retired: number
}

type ExistingSchedule = {
  id: string
  schedule_key: string
  resource_key: string | null
  first_due_at: Date
  payload: Record<string, unknown>
}

function readExistingSchedules(sql: Sql, provenanceSource: string): Promise<ExistingSchedule[]> {
  return sql<ExistingSchedule[]>`
    SELECT id, schedule_key, resource_key, first_due_at, payload
    FROM refresh_operations.schedules
    WHERE provenance ->> 'source' = ${provenanceSource} AND enabled
    FOR UPDATE
  `
}

function matchesDesired(
  existing: ExistingSchedule,
  desired: ResourceSchedule,
  identityPayloadFields: readonly string[],
): boolean {
  if (existing.schedule_key !== desired.scheduleKey) return false

  if (existing.first_due_at.getTime() !== new Date(desired.firstDueAt).getTime()) return false

  return identityPayloadFields.every((field) => existing.payload[field] === desired.payload[field])
}

async function retireSchedule(sql: Sql, scheduleId: string): Promise<void> {
  await sql`
    UPDATE refresh_operations.schedules
    SET enabled = false,
        schedule_key = schedule_key || ':retired:' || id::text,
        updated_at = clock_timestamp()
    WHERE id = ${scheduleId}
  `
}

async function insertSchedule(sql: Sql, schedule: ResourceSchedule): Promise<void> {
  await sql`
    INSERT INTO refresh_operations.schedules
      (id, schedule_key, kind, resource_key, work_class, interval_ms, first_due_at, next_due_at,
       operation_key_prefix, payload, provenance, max_attempts)
    VALUES
      (${randomUUID()}, ${schedule.scheduleKey}, ${schedule.job.kind}, ${schedule.resourceKey},
       ${schedule.workClass}, ${schedule.intervalMs}, ${schedule.firstDueAt}, ${schedule.firstDueAt},
       ${schedule.operationKeyPrefix}, ${sql.json(schedule.payload as never)},
       ${sql.json(schedule.provenance)}, ${schedule.maxAttempts})
  `
}

async function applyDesiredSchedules(
  sql: Sql,
  input: ReconcileResourceSchedulesInput,
): Promise<ReconcileResourceSchedulesResult> {
  const existingSchedules = await readExistingSchedules(sql, input.provenanceSource)
  const desiredByResource = new Map(input.schedules.map((schedule) => [schedule.resourceKey, schedule]))
  let retired = 0

  for (const existing of existingSchedules) {
    const desired = existing.resource_key ? desiredByResource.get(existing.resource_key) : undefined

    if (desired && matchesDesired(existing, desired, input.identityPayloadFields)) {
      desiredByResource.delete(desired.resourceKey)
      continue
    }

    await retireSchedule(sql, existing.id)
    retired++
  }

  for (const schedule of desiredByResource.values()) await insertSchedule(sql, schedule)

  return { created: desiredByResource.size, retired }
}

/**
 * Makes the enabled schedules of one provenance source match a desired set, keyed by resource: anything that changed
 * is retired and started again, rather than rewritten.
 */
export async function reconcileResourceSchedules(
  database: Database,
  input: ReconcileResourceSchedulesInput,
): Promise<ReconcileResourceSchedulesResult> {
  for (const schedule of input.schedules) {
    assertValidJobInput(schedule.job, schedule.workClass, schedule.payload)
    validateScheduleIdentity(schedule)
  }

  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    await sql`SELECT pg_advisory_xact_lock(${scheduleSetLockId})`

    if (await input.watermark.isSuperseded(sql, input.observedAt)) return { created: 0, retired: 0 }

    const result = await applyDesiredSchedules(sql, input)

    await input.watermark.record(sql, input.observedAt)

    return result
  })
}
