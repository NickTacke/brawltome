import type { Database, Sql } from '@brawltome/foundation'
import {
  type AdmissionCreditRow,
  admissionConfigHash,
  chooseBackgroundClass,
  validateAdmissionConfig,
} from '../domain/admission'
import type { EffectState } from '../jobs/job-definition'
import { assertValidJobInput } from '../jobs/job-input'
import {
  type AdmissionConfig,
  type BackgroundWorkClass,
  backgroundWorkClasses,
  type OperationLease,
  type WorkClass,
} from '../model'
import { admissionLockId } from './admission-lock'
import type { ClaimJob, ClaimJobs } from './claim-jobs'
import { type OperationRow, toLease } from './operation-row'

export type ClaimOperationInput = {
  workerId: string
  leaseMs: number
  admission: AdmissionConfig
  kind?: string
  jobs: ClaimJobs
  onInvalidRow?: (row: InvalidRow) => void
}

export type InvalidRow = { operationId: string; kind: string; reason: string }

type AdmissionPolicy = ReturnType<typeof admissionConfigHash>

type ActiveCounts = { byClass: Map<WorkClass, number>; total: number }

type WorkClassSelection = { workClass: WorkClass; nextCredits?: Map<BackgroundWorkClass, number> }

type ClaimOutcome = { kind: 'leased'; lease: OperationLease } | { kind: 'empty' } | { kind: 'retry' }

async function checkAdmissionPolicy(sql: Sql, policy: AdmissionPolicy): Promise<void> {
  await sql`
    INSERT INTO queue.admission_policy (singleton, config_hash, config)
    VALUES (true, ${policy.hash}, ${sql.json(policy.document)})
    ON CONFLICT (singleton) DO NOTHING
  `

  const [storedPolicy] = await sql<{ config_hash: string }[]>`
    SELECT config_hash FROM queue.admission_policy WHERE singleton FOR UPDATE
  `

  if (storedPolicy.config_hash !== policy.hash) {
    throw new Error('admission configuration differs from the policy active in PostgreSQL')
  }
}

async function readActiveCounts(sql: Sql): Promise<ActiveCounts> {
  const rows = await sql<{ work_class: WorkClass; count: string | number }[]>`
    SELECT work_class, count(*)::bigint AS count
    FROM queue.operations
    WHERE status = 'leased' AND lease_expires_at > clock_timestamp()
    GROUP BY work_class
  `

  return {
    byClass: new Map(rows.map((row) => [row.work_class, Number(row.count)])),
    total: rows.reduce((total, row) => total + Number(row.count), 0),
  }
}

async function readDueClasses(sql: Sql, kind: string | undefined): Promise<Set<WorkClass>> {
  const kindFilter = kind ? sql`AND kind = ${kind}` : sql``

  const rows = await sql<{ work_class: WorkClass }[]>`
    SELECT DISTINCT work_class
    FROM queue.operations
    WHERE ((status = 'pending' AND available_at <= clock_timestamp())
       OR (status = 'leased' AND lease_expires_at <= clock_timestamp()))
      ${kindFilter}
  `

  return new Set(rows.map((row) => row.work_class))
}

async function selectBackgroundClass(
  sql: Sql,
  eligible: BackgroundWorkClass[],
  admission: AdmissionConfig,
): Promise<WorkClassSelection> {
  for (const workClass of eligible) {
    await sql`
      INSERT INTO queue.admission_classes (work_class)
      VALUES (${workClass})
      ON CONFLICT (work_class) DO NOTHING
    `
  }

  const credits = await sql<AdmissionCreditRow[]>`
    SELECT work_class, credit
    FROM queue.admission_classes
    WHERE work_class IN ${sql(eligible)}
    FOR UPDATE
  `

  const selection = chooseBackgroundClass(eligible, credits, admission)

  return { workClass: selection.selected, nextCredits: selection.nextCredits }
}

async function selectWorkClass(
  sql: Sql,
  active: ActiveCounts,
  { admission, kind }: ClaimOperationInput,
): Promise<WorkClassSelection | null> {
  const due = await readDueClasses(sql, kind)

  const isEligible = (workClass: WorkClass) =>
    due.has(workClass) && (active.byClass.get(workClass) ?? 0) < admission.classConcurrency[workClass]

  const interactiveEligible = isEligible('interactive')
  const interactiveActive = active.byClass.get('interactive') ?? 0
  const backgroundActive = active.total - interactiveActive
  const backgroundCapacity = admission.totalConcurrency - admission.interactiveReservation
  const backgroundEligible = backgroundWorkClasses.filter(isEligible)

  if (interactiveEligible && interactiveActive < admission.interactiveReservation) {
    return { workClass: 'interactive' }
  }

  if (backgroundEligible.length > 0 && backgroundActive < backgroundCapacity) {
    return selectBackgroundClass(sql, backgroundEligible, admission)
  }

  if (!interactiveEligible) return null

  return { workClass: 'interactive' }
}

async function pickCandidate(
  sql: Sql,
  workClass: WorkClass,
  kind: string | undefined,
): Promise<OperationRow | undefined> {
  const kindFilter = kind ? sql`AND operation.kind = ${kind}` : sql``

  const [candidate] = await sql<OperationRow[]>`
    SELECT operation.id, operation.effect_operation_id,
           to_char(effect.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effect_created_at,
           operation.kind, operation.operation_key, operation.work_class, operation.payload,
           operation.provenance, operation.lease_owner, operation.lease_token, operation.attempt_count,
           operation.max_attempts, operation.status,
           (
             SELECT occurrence.window_due_at
               + (occurrence.missed_window_count * schedule.interval_ms) * interval '1 millisecond'
             FROM queue.schedule_occurrences occurrence
             JOIN queue.schedules schedule ON schedule.id = occurrence.schedule_id
             WHERE occurrence.id = operation.origin_schedule_occurrence_id
           ) AS scheduled_window_at
    FROM queue.operations operation
    JOIN queue.operations effect ON effect.id = operation.effect_operation_id
    WHERE operation.work_class = ${workClass}
      AND ((operation.status = 'pending' AND operation.available_at <= clock_timestamp())
        OR (operation.status = 'leased' AND operation.lease_expires_at <= clock_timestamp()))
      ${kindFilter}
    ORDER BY operation.available_at, operation.created_at, operation.id
    FOR UPDATE OF operation SKIP LOCKED
    LIMIT 1
  `

  return candidate
}

async function takeClaimLock(sql: Sql, job: ClaimJob | undefined, candidate: OperationRow): Promise<void> {
  const claimLockKey = job?.claimLockKey?.(candidate.effect_operation_id)

  if (!claimLockKey) return

  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${claimLockKey}, 200)
    )
  `
}

function readEffectState(job: ClaimJob | undefined, sql: Sql, candidate: OperationRow): Promise<EffectState> {
  if (!job?.effectState) return Promise.resolve('none')

  return job.effectState(sql, {
    operationId: candidate.id,
    effectOperationId: candidate.effect_operation_id,
    payload: candidate.payload,
  })
}

async function finishAcknowledged(sql: Sql, candidate: OperationRow): Promise<void> {
  await sql`
    UPDATE queue.attempts
    SET finished_at = clock_timestamp(), outcome = 'succeeded'
    WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
      AND finished_at IS NULL
  `

  await sql`
    UPDATE queue.operations
    SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = ${candidate.id}
  `
}

async function expireAttempt(sql: Sql, candidate: OperationRow): Promise<void> {
  await sql`
    UPDATE queue.attempts
    SET finished_at = clock_timestamp(), outcome = 'lease_expired',
        error = ${sql.json({ code: 'lease_expired', message: 'Worker lease expired' })}
    WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
      AND finished_at IS NULL
  `
}

async function deadLetterExhausted(sql: Sql, candidate: OperationRow): Promise<void> {
  await sql`
    UPDATE queue.operations
    SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp(),
        last_error = ${sql.json({ code: 'lease_expired', message: 'Maximum attempts exhausted' })}
    WHERE id = ${candidate.id}
  `
}

// null when the job can run this row, otherwise why it can't
function describeInvalidCandidate(job: ClaimJob | undefined, candidate: OperationRow): string | null {
  if (!job) return `No job is registered for kind ${candidate.kind}`

  try {
    assertValidJobInput(job, candidate.work_class, candidate.payload)
  } catch (error) {
    return error instanceof Error ? error.message : 'Payload failed validation'
  }

  return null
}

// settled here rather than thrown: a throw would roll back this claim and pick the same row on every later poll
async function deadLetterInvalidCandidate(sql: Sql, candidate: OperationRow, message: string): Promise<void> {
  const failure = { code: 'invalid_payload', message, retryable: false }

  await sql`
    UPDATE queue.attempts
    SET finished_at = clock_timestamp(), outcome = 'dead_letter', error = ${sql.json(failure)}
    WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
      AND finished_at IS NULL
  `

  await sql`
    UPDATE queue.operations
    SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp(),
        last_error = ${sql.json(failure)}
    WHERE id = ${candidate.id}
  `
}

// true when the expired lease ended the operation, so this candidate must not be leased again
async function finishOrExpireLease(sql: Sql, job: ClaimJob | undefined, candidate: OperationRow): Promise<boolean> {
  const effectState = await readEffectState(job, sql, candidate)

  if (effectState === 'acknowledged') {
    await finishAcknowledged(sql, candidate)

    return true
  }

  await expireAttempt(sql, candidate)

  const isExhausted = candidate.attempt_count >= candidate.max_attempts && effectState !== 'applied'

  if (!isExhausted) return false

  await deadLetterExhausted(sql, candidate)

  return true
}

async function leaseCandidate(
  sql: Sql,
  candidate: OperationRow,
  { workerId, leaseMs }: ClaimOperationInput,
): Promise<OperationRow> {
  const [leased] = await sql<OperationRow[]>`
    UPDATE queue.operations
    SET status = 'leased', lease_owner = ${workerId},
        lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
        lease_token = lease_token + 1, attempt_count = attempt_count + 1,
        updated_at = clock_timestamp()
    WHERE id = ${candidate.id}
    RETURNING id, effect_operation_id, operation_key, kind, work_class, payload, provenance,
              lease_owner, lease_token, attempt_count, max_attempts, status
  `

  await sql`
    INSERT INTO queue.attempts
      (operation_id, attempt_number, lease_token, lease_owner)
    VALUES (${leased.id}, ${leased.attempt_count}, ${leased.lease_token}, ${workerId})
  `

  return leased
}

async function saveNextCredits(sql: Sql, nextCredits: WorkClassSelection['nextCredits']): Promise<void> {
  if (!nextCredits) return

  for (const [workClass, credit] of nextCredits) {
    await sql`
      UPDATE queue.admission_classes
      SET credit = ${credit}, updated_at = clock_timestamp()
      WHERE work_class = ${workClass}
    `
  }
}

async function claimOnce(sql: Sql, input: ClaimOperationInput, policy: AdmissionPolicy): Promise<ClaimOutcome> {
  await sql`SELECT pg_advisory_xact_lock(${admissionLockId})`

  await checkAdmissionPolicy(sql, policy)

  const active = await readActiveCounts(sql)

  if (active.total >= input.admission.totalConcurrency) return { kind: 'empty' }

  const selection = await selectWorkClass(sql, active, input)

  if (!selection) return { kind: 'empty' }

  const candidate = await pickCandidate(sql, selection.workClass, input.kind)

  if (!candidate) return { kind: 'retry' }

  const job = input.jobs.get(candidate.kind)
  const invalidReason = describeInvalidCandidate(job, candidate)

  if (invalidReason) {
    await deadLetterInvalidCandidate(sql, candidate, invalidReason)
    input.onInvalidRow?.({ operationId: candidate.id, kind: candidate.kind, reason: invalidReason })

    return { kind: 'retry' }
  }

  await takeClaimLock(sql, job, candidate)

  const isSettled = candidate.status === 'leased' && (await finishOrExpireLease(sql, job, candidate))

  if (isSettled) return { kind: 'retry' }

  const leased = await leaseCandidate(sql, candidate, input)

  await saveNextCredits(sql, selection.nextCredits)

  const lease = toLease({
    ...leased,
    effect_created_at: candidate.effect_created_at,
    scheduled_window_at: candidate.scheduled_window_at,
  })

  return { kind: 'leased', lease }
}

/**
 * Leases the next due operation, or returns null when nothing can be admitted right now.
 * A pass that only cleaned up an expired lease, dead-lettered a row or lost a race starts over in a new transaction.
 */
export async function claimOperation(database: Database, input: ClaimOperationInput): Promise<OperationLease | null> {
  validateAdmissionConfig(input.admission)

  const policy = admissionConfigHash(input.admission)

  for (;;) {
    const outcome = await database.sql.begin((transaction) => claimOnce(transaction as unknown as Sql, input, policy))

    if (outcome.kind === 'leased') return outcome.lease

    if (outcome.kind === 'empty') return null
  }
}
