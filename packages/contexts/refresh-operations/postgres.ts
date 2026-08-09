import { createHash, randomUUID } from 'node:crypto'
import {
  type AcceptOperationResult,
  type AcceptProofOperation,
  type AdmissionConfig,
  type BackgroundWorkClass,
  type CreateProofSchedule,
  type CreateScheduleResult,
  type FencedResult,
  type MaterializeSchedulesResult,
  type OperationFailure,
  type OperationLease,
  type TransitionResult,
  type WorkClass,
  backgroundWorkClasses,
  validateAdmissionConfig,
  workClasses,
} from '@brawltome/refresh-operations'
import postgres from 'postgres'

const wakeupChannel = 'refresh_operations_wakeup'
const admissionLockId = 1_920_192
const utcDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

type OperationRow = {
  id: string
  operation_key: string
  work_class: WorkClass
  payload: { value: string }
  provenance: { source: string; requestedBy?: string }
  lease_owner: string
  lease_token: string | number
  attempt_count: number
  max_attempts: number
  status: string
}

type ScheduleRow = {
  id: string
  schedule_key: string
  work_class: WorkClass
  interval_ms: string | number
  first_due_at: Date
  next_window_number: string | number
  next_due_at: Date
  operation_key_prefix: string
  payload: { value: string }
  provenance: { source: string; requestedBy?: string }
  max_attempts: number
  materialized_at: Date
  due_window_count: string | number
}

type AdmissionCreditRow = {
  work_class: BackgroundWorkClass
  credit: string | number
}

function toLease(row: OperationRow): OperationLease {
  return {
    operationId: row.id,
    operationKey: row.operation_key,
    workClass: row.work_class,
    payload: row.payload,
    provenance: row.provenance,
    leaseOwner: row.lease_owner,
    leaseToken: Number(row.lease_token),
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
  }
}

function parseFirstDueAt(value: string): Date {
  if (!utcDateTime.test(value)) throw new Error('firstDueAt must be an ISO-8601 UTC timestamp ending in Z')
  const parsed = new Date(value)
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
  )
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error('firstDueAt must be a valid timestamp')
  }
  return parsed
}

function validateSchedule(input: CreateProofSchedule): Date {
  if (!input.scheduleKey || input.scheduleKey.length > 200) {
    throw new Error('scheduleKey must contain between 1 and 200 characters')
  }
  if (!input.operationKeyPrefix || input.operationKeyPrefix.length > 200) {
    throw new Error('operationKeyPrefix must contain between 1 and 200 characters')
  }
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error('intervalMs must be a positive safe integer')
  }
  return parseFirstDueAt(input.firstDueAt)
}

function admissionConfigDocument(config: AdmissionConfig) {
  return {
    totalConcurrency: config.totalConcurrency,
    interactiveReservation: config.interactiveReservation,
    classConcurrency: Object.fromEntries(
      workClasses.map((workClass) => [workClass, config.classConcurrency[workClass]]),
    ),
    backgroundWeights: Object.fromEntries(
      backgroundWorkClasses.map((workClass) => [workClass, config.backgroundWeights[workClass]]),
    ),
  }
}

function admissionConfigHash(config: AdmissionConfig): {
  document: ReturnType<typeof admissionConfigDocument>
  hash: string
} {
  const document = admissionConfigDocument(config)
  return { document, hash: createHash('sha256').update(JSON.stringify(document)).digest('hex') }
}

function chooseBackgroundClass(
  eligible: readonly BackgroundWorkClass[],
  credits: readonly AdmissionCreditRow[],
  config: AdmissionConfig,
): { selected: BackgroundWorkClass; nextCredits: Map<BackgroundWorkClass, number> } {
  const stored = new Map(credits.map((row) => [row.work_class, Number(row.credit)]))
  const nextCredits = new Map<BackgroundWorkClass, number>()
  let selected = eligible[0]
  let selectedScore = Number.NEGATIVE_INFINITY
  let totalWeight = 0

  for (const workClass of eligible) {
    const weight = config.backgroundWeights[workClass]
    totalWeight += weight
    const score = (stored.get(workClass) ?? 0) + weight
    nextCredits.set(workClass, score)
    if (score > selectedScore) {
      selected = workClass
      selectedScore = score
    }
  }
  nextCredits.set(selected, (nextCredits.get(selected) ?? 0) - totalWeight)
  return { selected, nextCredits }
}

export function createPostgresRefreshOperations(connectionString: string) {
  const client = postgres(connectionString)

  return {
    async configureAdmission(admission: AdmissionConfig): Promise<void> {
      validateAdmissionConfig(admission)
      const policy = admissionConfigHash(admission)
      await client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(${admissionLockId})`
        const [active] = await sql<{ count: string | number }[]>`
          SELECT count(*)::bigint AS count
          FROM refresh_operations.operations
          WHERE status = 'leased' AND lease_expires_at > clock_timestamp()
        `
        const [existing] = await sql<{ config_hash: string }[]>`
          SELECT config_hash FROM refresh_operations.admission_policy WHERE singleton FOR UPDATE
        `
        if (existing && existing.config_hash !== policy.hash && Number(active.count) > 0) {
          throw new Error('admission configuration cannot change while operations are actively leased')
        }
        await sql`
          INSERT INTO refresh_operations.admission_policy (singleton, config_hash, config)
          VALUES (true, ${policy.hash}, ${sql.json(policy.document)})
          ON CONFLICT (singleton) DO UPDATE
          SET config_hash = EXCLUDED.config_hash, config = EXCLUDED.config, updated_at = clock_timestamp()
        `
        if (existing && existing.config_hash !== policy.hash) {
          await sql`UPDATE refresh_operations.admission_classes SET credit = 0, updated_at = clock_timestamp()`
        }
      })
    },

    async accept(input: AcceptProofOperation): Promise<AcceptOperationResult> {
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          const operationId = randomUUID()
          const inserted = await sql<{ id: string }[]>`
            INSERT INTO refresh_operations.operations
              (id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
            VALUES
              (${operationId}, 'proof', ${input.dedupeKey}, ${input.operationKey}, ${input.workClass},
               ${sql.json(input.payload)}, ${sql.json(input.provenance)}, ${input.maxAttempts ?? 3})
            ON CONFLICT (kind, dedupe_key) WHERE status IN ('pending', 'leased')
            DO NOTHING
            RETURNING id
          `
          if (inserted[0]) {
            await sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`
            return { outcome: 'accepted' as const, operationId }
          }

          const [active] = await sql<{ id: string }[]>`
            SELECT id FROM refresh_operations.operations
            WHERE kind = 'proof' AND dedupe_key = ${input.dedupeKey} AND status IN ('pending', 'leased')
          `
          return active ? { outcome: 'already-active' as const, operationId: active.id } : null
        })
        if (result) return result
      }
    },

    async createSchedule(input: CreateProofSchedule): Promise<CreateScheduleResult> {
      const firstDueAt = validateSchedule(input)
      const scheduleId = randomUUID()
      const [created] = await client<{ id: string }[]>`
        INSERT INTO refresh_operations.schedules
          (id, schedule_key, kind, work_class, interval_ms, first_due_at, next_due_at,
           operation_key_prefix, payload, provenance, max_attempts)
        VALUES
          (${scheduleId}, ${input.scheduleKey}, 'proof', ${input.workClass}, ${input.intervalMs},
           ${firstDueAt}, ${firstDueAt}, ${input.operationKeyPrefix}, ${client.json(input.payload)},
           ${client.json(input.provenance)}, ${input.maxAttempts ?? 3})
        ON CONFLICT (schedule_key) DO NOTHING
        RETURNING id
      `
      if (created) return { outcome: 'created', scheduleId: created.id }

      const [existing] = await client<{ id: string; matches: boolean }[]>`
        SELECT id,
          work_class = ${input.workClass}
          AND interval_ms = ${input.intervalMs}
          AND first_due_at = ${firstDueAt}
          AND operation_key_prefix = ${input.operationKeyPrefix}
          AND payload = ${client.json(input.payload)}::jsonb
          AND provenance = ${client.json(input.provenance)}::jsonb
          AND max_attempts = ${input.maxAttempts ?? 3} AS matches
        FROM refresh_operations.schedules
        WHERE schedule_key = ${input.scheduleKey}
      `
      if (!existing?.matches) throw new Error(`scheduleKey ${input.scheduleKey} already has a different definition`)
      return { outcome: 'already-exists', scheduleId: existing.id }
    },

    async materializeDueSchedules(limit = 100): Promise<MaterializeSchedulesResult> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('schedule materialization limit must be an integer between 1 and 1000')
      }
      const result = await client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [clock] = await sql<{ materialized_at: Date }[]>`
          SELECT clock_timestamp() AS materialized_at
        `
        const schedules = await sql<ScheduleRow[]>`
          SELECT id, schedule_key, work_class, interval_ms, first_due_at, next_window_number,
                 next_due_at, operation_key_prefix, payload, provenance, max_attempts,
                 ${clock.materialized_at}::timestamptz AS materialized_at,
                 floor(
                   extract(epoch FROM (${clock.materialized_at}::timestamptz - next_due_at)) * 1000 / interval_ms
                 )::bigint + 1 AS due_window_count
          FROM refresh_operations.schedules
          WHERE enabled AND next_due_at <= ${clock.materialized_at}
          ORDER BY next_due_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        `
        const scheduleIds: string[] = []
        for (const schedule of schedules) {
          const dueWindowCount = Number(schedule.due_window_count)
          const missedWindowCount = dueWindowCount - 1
          const firstWindowNumber = Number(schedule.next_window_number)
          const nextWindowNumber = firstWindowNumber + dueWindowCount
          const operationId = randomUUID()
          const occurrenceId = randomUUID()
          const windowDueAt = schedule.next_due_at
          const materializedAt = schedule.materialized_at
          const latenessMs = Math.max(0, materializedAt.getTime() - windowDueAt.getTime())
          const windowIdentity = `${schedule.id}:${firstWindowNumber}`

          await sql`
            INSERT INTO refresh_operations.operations
              (id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts, available_at)
            VALUES
              (${operationId}, 'proof', ${`schedule:${windowIdentity}`},
               ${`${schedule.operation_key_prefix}:${schedule.id}:${firstWindowNumber}`}, ${schedule.work_class},
               ${sql.json(schedule.payload)}, ${sql.json(schedule.provenance)}, ${schedule.max_attempts},
               ${materializedAt})
          `
          await sql`
            INSERT INTO refresh_operations.schedule_occurrences
              (id, schedule_id, operation_id, first_window_number, last_window_number,
               window_due_at, materialized_at, lateness_ms, missed_window_count, catch_up)
            VALUES
              (${occurrenceId}, ${schedule.id}, ${operationId}, ${firstWindowNumber},
               ${nextWindowNumber - 1}, ${windowDueAt}, ${materializedAt}, ${latenessMs},
               ${missedWindowCount}, ${missedWindowCount > 0})
          `
          await sql`
            UPDATE refresh_operations.schedules
            SET next_window_number = ${nextWindowNumber},
                next_due_at = first_due_at + (${nextWindowNumber} * interval_ms * interval '1 millisecond'),
                updated_at = ${materializedAt}
            WHERE id = ${schedule.id}
          `
          await sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`
          scheduleIds.push(schedule.id)
        }
        return { occurrencesCreated: schedules.length, scheduleIds }
      })
      return result
    },

    async claim(workerId: string, leaseMs: number, admission: AdmissionConfig): Promise<OperationLease | null> {
      validateAdmissionConfig(admission)
      const policy = admissionConfigHash(admission)
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          await sql`SELECT pg_advisory_xact_lock(${admissionLockId})`
          await sql`
            INSERT INTO refresh_operations.admission_policy (singleton, config_hash, config)
            VALUES (true, ${policy.hash}, ${sql.json(policy.document)})
            ON CONFLICT (singleton) DO NOTHING
          `
          const [storedPolicy] = await sql<{ config_hash: string }[]>`
            SELECT config_hash FROM refresh_operations.admission_policy WHERE singleton FOR UPDATE
          `
          if (storedPolicy.config_hash !== policy.hash) {
            throw new Error('admission configuration differs from the policy active in PostgreSQL')
          }

          const activeRows = await sql<{ work_class: WorkClass; count: string | number }[]>`
            SELECT work_class, count(*)::bigint AS count
            FROM refresh_operations.operations
            WHERE status = 'leased' AND lease_expires_at > clock_timestamp()
            GROUP BY work_class
          `
          const active = new Map(activeRows.map((row) => [row.work_class, Number(row.count)]))
          const activeTotal = activeRows.reduce((total, row) => total + Number(row.count), 0)
          if (activeTotal >= admission.totalConcurrency) return { kind: 'empty' as const }

          const dueRows = await sql<{ work_class: WorkClass }[]>`
            SELECT DISTINCT work_class
            FROM refresh_operations.operations
            WHERE (status = 'pending' AND available_at <= clock_timestamp())
               OR (status = 'leased' AND lease_expires_at <= clock_timestamp())
          `
          const due = new Set(dueRows.map((row) => row.work_class))
          const eligible = (workClass: WorkClass) =>
            due.has(workClass) && (active.get(workClass) ?? 0) < admission.classConcurrency[workClass]

          const interactiveEligible = eligible('interactive')
          const interactiveActive = active.get('interactive') ?? 0
          const backgroundEligible = backgroundWorkClasses.filter(eligible)
          let selectedClass: WorkClass | undefined
          let nextCredits: Map<BackgroundWorkClass, number> | undefined

          if (interactiveEligible && interactiveActive < admission.interactiveReservation) {
            selectedClass = 'interactive'
          } else if (backgroundEligible.length > 0) {
            for (const workClass of backgroundEligible) {
              await sql`
                INSERT INTO refresh_operations.admission_classes (work_class)
                VALUES (${workClass})
                ON CONFLICT (work_class) DO NOTHING
              `
            }
            const credits = await sql<AdmissionCreditRow[]>`
              SELECT work_class, credit
              FROM refresh_operations.admission_classes
              WHERE work_class IN ${sql(backgroundEligible)}
              FOR UPDATE
            `
            const selection = chooseBackgroundClass(backgroundEligible, credits, admission)
            selectedClass = selection.selected
            nextCredits = selection.nextCredits
          } else if (interactiveEligible) {
            selectedClass = 'interactive'
          }
          if (!selectedClass) return { kind: 'empty' as const }

          const [candidate] = await sql<OperationRow[]>`
            SELECT id, operation_key, work_class, payload, provenance, lease_owner, lease_token,
                   attempt_count, max_attempts, status
            FROM refresh_operations.operations
            WHERE work_class = ${selectedClass}
              AND ((status = 'pending' AND available_at <= clock_timestamp())
                OR (status = 'leased' AND lease_expires_at <= clock_timestamp()))
            ORDER BY available_at, created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `
          if (!candidate) return { kind: 'retry' as const }

          if (candidate.status === 'leased') {
            const [effect] = await sql<{ operation_id: string }[]>`
              SELECT operation_id FROM refresh_operations.proof_effects
              WHERE operation_id = ${candidate.id}
            `
            if (effect) {
              await sql`
                UPDATE refresh_operations.attempts
                SET finished_at = clock_timestamp(), outcome = 'succeeded'
                WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
                  AND finished_at IS NULL
              `
              await sql`
                UPDATE refresh_operations.operations
                SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
                    completed_at = clock_timestamp(), updated_at = clock_timestamp()
                WHERE id = ${candidate.id}
              `
              return { kind: 'retry' as const }
            }
            await sql`
              UPDATE refresh_operations.attempts
              SET finished_at = clock_timestamp(), outcome = 'lease_expired',
                  error = ${sql.json({ code: 'lease_expired', message: 'Worker lease expired' })}
              WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
                AND finished_at IS NULL
            `
            if (candidate.attempt_count >= candidate.max_attempts) {
              await sql`
                UPDATE refresh_operations.operations
                SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
                    completed_at = clock_timestamp(), updated_at = clock_timestamp(),
                    last_error = ${sql.json({ code: 'lease_expired', message: 'Maximum attempts exhausted' })}
                WHERE id = ${candidate.id}
              `
              return { kind: 'retry' as const }
            }
          }

          const [leased] = await sql<OperationRow[]>`
            UPDATE refresh_operations.operations
            SET status = 'leased', lease_owner = ${workerId},
                lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
                lease_token = lease_token + 1, attempt_count = attempt_count + 1,
                updated_at = clock_timestamp()
            WHERE id = ${candidate.id}
            RETURNING id, operation_key, work_class, payload, provenance, lease_owner, lease_token,
                      attempt_count, max_attempts, status
          `
          await sql`
            INSERT INTO refresh_operations.attempts
              (operation_id, attempt_number, lease_token, lease_owner)
            VALUES (${leased.id}, ${leased.attempt_count}, ${leased.lease_token}, ${workerId})
          `
          if (nextCredits) {
            for (const [workClass, credit] of nextCredits) {
              await sql`
                UPDATE refresh_operations.admission_classes
                SET credit = ${credit}, updated_at = clock_timestamp()
                WHERE work_class = ${workClass}
              `
            }
          }
          return { kind: 'leased' as const, lease: toLease(leased) }
        })
        if (result.kind === 'leased') return result.lease
        if (result.kind === 'empty') return null
      }
    },

    async commitProofEffect(lease: OperationLease): Promise<FencedResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<{ id: string; operation_key: string; payload: { value: string } }[]>`
          SELECT id, operation_key, payload FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        const inserted = await sql<{ operation_key: string }[]>`
          INSERT INTO refresh_operations.proof_effects
            (operation_key, operation_id, lease_token, effect_value)
          VALUES (${owned.operation_key}, ${owned.id}, ${lease.leaseToken}, ${sql.json(owned.payload)})
          ON CONFLICT (operation_key) DO NOTHING
          RETURNING operation_key
        `
        if (inserted[0]) return 'applied' as const
        const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
          SELECT operation_id, effect_value = ${sql.json(owned.payload)}::jsonb AS matches_payload
          FROM refresh_operations.proof_effects
          WHERE operation_key = ${owned.operation_key}
        `
        return existing?.operation_id === owned.id && existing.matches_payload
          ? ('already-applied' as const)
          : ('effect-conflict' as const)
      })
    },

    async complete(lease: OperationLease): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const updated = await sql<{ id: string }[]>`
          UPDATE refresh_operations.operations
          SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          RETURNING id
        `
        if (!updated[0]) return 'lease-lost' as const
        await sql`
          UPDATE refresh_operations.attempts
          SET finished_at = clock_timestamp(), outcome = 'succeeded'
          WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
        `
        return 'transitioned' as const
      })
    },

    async fail(lease: OperationLease, failure: OperationFailure, retryDelayMs: number): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<{ attempt_count: number; max_attempts: number }[]>`
          SELECT attempt_count, max_attempts FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        const retry = failure.retryable && owned.attempt_count < owned.max_attempts
        await sql`
          UPDATE refresh_operations.attempts
          SET finished_at = clock_timestamp(), outcome = ${retry ? 'retry' : 'dead_letter'},
              error = ${sql.json(failure)}
          WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
        `
        await sql`
          UPDATE refresh_operations.operations
          SET status = ${retry ? 'pending' : 'dead_letter'}, lease_owner = NULL, lease_expires_at = NULL,
              available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
              completed_at = ${retry ? null : sql`clock_timestamp()`},
              last_error = ${sql.json(failure)}, updated_at = clock_timestamp()
          WHERE id = ${lease.operationId}
        `
        return 'transitioned' as const
      })
    },

    async inspect(operationId: string) {
      const [operation] = await client`
        SELECT * FROM refresh_operations.operations WHERE id = ${operationId}
      `
      const attempts = await client`
        SELECT * FROM refresh_operations.attempts WHERE operation_id = ${operationId} ORDER BY attempt_number
      `
      const effects = await client`
        SELECT * FROM refresh_operations.proof_effects WHERE operation_id = ${operationId}
      `
      return { operation, attempts, effects }
    },

    async inspectSchedule(scheduleId: string) {
      const [schedule] = await client`
        SELECT * FROM refresh_operations.schedules WHERE id = ${scheduleId}
      `
      const occurrences = await client`
        SELECT occurrence.*, operation.status AS operation_status,
               operation.attempt_count, operation.last_error, operation.completed_at
        FROM refresh_operations.schedule_occurrences occurrence
        JOIN refresh_operations.operations operation ON operation.id = occurrence.operation_id
        WHERE occurrence.schedule_id = ${scheduleId}
        ORDER BY occurrence.window_due_at
      `
      return { schedule, occurrences }
    },

    listen(onWakeup: (operationId: string) => void) {
      return client.listen(wakeupChannel, onWakeup)
    },

    async close() {
      await client.end()
    },
  }
}

export type PostgresRefreshOperations = ReturnType<typeof createPostgresRefreshOperations>
