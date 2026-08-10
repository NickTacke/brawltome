import { createHash, randomUUID } from 'node:crypto'
import {
  type AcceptOperation,
  type AcceptOperationResult,
  type AdmissionConfig,
  type BackgroundWorkClass,
  type CreateLeaderboardSchedule,
  type CreateSchedule,
  type CreateScheduleResult,
  type DeadLetterDisposition,
  type DeadLetterDispositionInput,
  type DeadLetterDispositionResult,
  type DeadLetterInspection,
  type DeadLetterListItem,
  type DeadLetterOperations,
  type DeadLetterPage,
  type FencedResult,
  type InteractiveClanRefreshReservation,
  type InteractivePlayerRefreshReservation,
  type MaterializeSchedulesResult,
  type OperationFailure,
  type OperationLease,
  type ReserveInteractiveRefreshResult,
  type TransitionResult,
  type WorkClass,
  backgroundWorkClasses,
  validateAdmissionConfig,
  validateLeaderboardOperationPayload,
  workClasses,
} from '@brawltome/refresh-operations'
import postgres from 'postgres'

const wakeupChannel = 'refresh_operations_wakeup'
const admissionLockId = 1_920_192
const utcDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

type OperationRow = {
  id: string
  effect_operation_id: string
  kind: OperationLease['kind']
  operation_key: string
  work_class: WorkClass
  payload: OperationLease['payload']
  provenance: { source: string; requestedBy?: string }
  lease_owner: string
  lease_token: string | number
  attempt_count: number
  max_attempts: number
  status: string
  scheduled_window_at: Date | null
}

type ScheduleRow = {
  id: string
  schedule_key: string
  kind: 'proof' | 'leaderboard-1v1'
  work_class: WorkClass
  interval_ms: string | number
  first_due_at: Date
  next_window_number: string | number
  next_due_at: Date
  operation_key_prefix: string
  payload: { value: string } | { pageDepth: number; intervalMs: number }
  provenance: { source: string; requestedBy?: string }
  max_attempts: number
  materialized_at: Date
  due_window_count: string | number
}

type AdmissionCreditRow = {
  work_class: BackgroundWorkClass
  credit: string | number
}

type DeadLetterListRow = {
  id: string
  kind: OperationLease['kind']
  operation_key: string
  work_class: WorkClass
  provenance: OperationLease['provenance']
  attempt_count: number
  max_attempts: number
  last_error: OperationFailure | null
  completed_at: Date
  disposition: DeadLetterDisposition | null
}

function toDeadLetterListItem(row: DeadLetterListRow): DeadLetterListItem {
  return {
    operationId: row.id,
    kind: row.kind,
    operationKey: row.operation_key,
    workClass: row.work_class,
    provenance: row.provenance,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    deadLetteredAt: row.completed_at.toISOString(),
    disposition: row.disposition,
  }
}

function toLease(row: OperationRow): OperationLease {
  const common = {
    operationId: row.id,
    effectOperationId: row.effect_operation_id,
    operationKey: row.operation_key,
    provenance: row.provenance,
    leaseOwner: row.lease_owner,
    leaseToken: Number(row.lease_token),
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
    scheduleWindowAt: row.scheduled_window_at?.toISOString() ?? null,
  }
  if (row.kind === 'leaderboard-1v1') {
    if (row.work_class !== 'leaderboard' || !('pageDepth' in row.payload)) {
      throw new Error('invalid durable leaderboard operation')
    }
    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }
  if (row.kind === 'interactive-player-refresh') {
    if (row.work_class !== 'interactive' || !('brawlhallaId' in row.payload)) {
      throw new Error('invalid durable interactive player refresh operation')
    }
    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }
  if (row.kind === 'clan-refresh') {
    if (row.work_class !== 'interactive' || !('clanId' in row.payload)) {
      throw new Error('invalid durable clan refresh operation')
    }
    return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
  }
  if (!('value' in row.payload)) throw new Error('invalid durable proof operation')
  return { ...common, kind: row.kind, workClass: row.work_class, payload: row.payload }
}

function validateDispositionInput(input: DeadLetterDispositionInput) {
  const actorId = input.actorId.trim()
  const reason = input.reason.trim()
  if ([...actorId].length < 1 || [...actorId].length > 200) {
    throw new Error('actorId must contain between 1 and 200 characters')
  }
  if ([...reason].length < 1 || [...reason].length > 500) {
    throw new Error('reason must contain between 1 and 500 characters')
  }
  return { actorId, reason }
}

function toDispositionResult(row: {
  id: string
  disposition: DeadLetterDisposition
  replay_operation_id: string | null
}): DeadLetterDispositionResult {
  if (row.disposition === 'replayed' && row.replay_operation_id) {
    return {
      outcome: 'already-disposed',
      disposition: 'replayed',
      actionId: row.id,
      replayOperationId: row.replay_operation_id,
    }
  }
  return {
    outcome: 'already-disposed',
    disposition: 'discarded',
    actionId: row.id,
    replayOperationId: null,
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

function operationKind(input: { kind?: 'proof' | 'leaderboard-1v1' }): 'proof' | 'leaderboard-1v1' {
  return input.kind ?? 'proof'
}

function validateSchedule(input: CreateSchedule): Date {
  if (!input.scheduleKey || input.scheduleKey.length > 200) {
    throw new Error('scheduleKey must contain between 1 and 200 characters')
  }
  if (!input.operationKeyPrefix || input.operationKeyPrefix.length > 200) {
    throw new Error('operationKeyPrefix must contain between 1 and 200 characters')
  }
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error('intervalMs must be a positive safe integer')
  }
  if (operationKind(input) === 'leaderboard-1v1') {
    const payload = validateLeaderboardOperationPayload(input.payload as { pageDepth: number; intervalMs: number })
    if (payload.intervalMs !== input.intervalMs) {
      throw new Error('leaderboard payload intervalMs must match the schedule intervalMs')
    }
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

export function createPostgresRefreshOperations(
  connectionString: string,
  options: { executionConcurrency?: number } = {},
) {
  const executionConcurrency = options.executionConcurrency
  if (executionConcurrency !== undefined && (!Number.isInteger(executionConcurrency) || executionConcurrency <= 0)) {
    throw new Error('executionConcurrency must be a positive integer')
  }
  const client =
    executionConcurrency === undefined
      ? postgres(connectionString)
      : postgres(connectionString, { max: executionConcurrency + 2 })
  const renewalClient =
    executionConcurrency === undefined ? client : postgres(connectionString, { max: executionConcurrency })

  async function disposeDeadLetter(
    disposition: DeadLetterDisposition,
    input: DeadLetterDispositionInput,
  ): Promise<DeadLetterDispositionResult> {
    const { actorId, reason } = validateDispositionInput(input)
    return client.begin(async (transaction) => {
      const sql = transaction as unknown as typeof client
      const [target] = await sql<
        {
          id: string
          effect_operation_id: string
          kind: OperationLease['kind']
          dedupe_key: string
          operation_key: string
          work_class: WorkClass
          payload_version: number
          payload: OperationLease['payload']
          provenance: OperationLease['provenance']
          max_attempts: number
          lease_token: string | number
          origin_schedule_occurrence_id: string | null
        }[]
      >`
        SELECT id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload_version,
               payload, provenance, max_attempts, lease_token, origin_schedule_occurrence_id
        FROM refresh_operations.operations
        WHERE id = ${input.operationId} AND status = 'dead_letter'
        FOR UPDATE
      `
      if (!target) {
        return { outcome: 'not-found', disposition: null, actionId: null, replayOperationId: null }
      }

      const [existing] = await sql<
        {
          id: string
          disposition: DeadLetterDisposition
          replay_operation_id: string | null
        }[]
      >`
        SELECT id, disposition, replay_operation_id
        FROM refresh_operations.dead_letter_actions
        WHERE target_operation_id = ${target.id}
      `
      if (existing) return toDispositionResult(existing)

      const actionId = randomUUID()
      let replayOperationId: string | null = null
      if (disposition === 'replayed') {
        replayOperationId = randomUUID()
        await sql`
          INSERT INTO refresh_operations.operations
            (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload_version,
             payload, provenance, max_attempts, lease_token, replayed_from_operation_id,
             origin_schedule_occurrence_id)
          VALUES
            (${replayOperationId}, ${target.effect_operation_id}, ${target.kind},
             ${`${target.dedupe_key}:replay:${actionId}`}, ${target.operation_key}, ${target.work_class},
             ${target.payload_version}, ${sql.json(target.payload)}, ${sql.json(target.provenance)},
             ${target.max_attempts}, ${target.lease_token}, ${target.id}, ${target.origin_schedule_occurrence_id})
        `
      }
      await sql`
        INSERT INTO refresh_operations.dead_letter_actions
          (id, target_operation_id, disposition, actor_id, reason, replay_operation_id)
        VALUES (${actionId}, ${target.id}, ${disposition}, ${actorId}, ${reason}, ${replayOperationId})
      `
      if (replayOperationId) {
        await sql`SELECT pg_notify(${wakeupChannel}, ${replayOperationId})`
        return { outcome: 'replayed', disposition: 'replayed', actionId, replayOperationId }
      }
      return { outcome: 'discarded', disposition: 'discarded', actionId, replayOperationId: null }
    })
  }

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

    async findActiveInteractivePlayerRefresh(dedupeKey: string) {
      const [active] = await client<{ id: string; awaiting_admission: boolean; reservation_expired: boolean }[]>`
        SELECT id,
          status = 'awaiting_admission' AS awaiting_admission,
          status = 'awaiting_admission' AND reservation_expires_at <= clock_timestamp() AS reservation_expired
        FROM refresh_operations.operations
        WHERE kind = 'interactive-player-refresh' AND dedupe_key = ${dedupeKey}
          AND status IN ('awaiting_admission', 'pending', 'leased')
      `
      return active
        ? {
            operationId: active.id,
            awaitingAdmission: active.awaiting_admission,
            reservationExpired: active.reservation_expired,
          }
        : null
    },

    async findActiveInteractiveClanRefresh(dedupeKey: string) {
      const [active] = await client<{ id: string; awaiting_admission: boolean; reservation_expired: boolean }[]>`
        SELECT id,
          status = 'awaiting_admission' AS awaiting_admission,
          status = 'awaiting_admission' AND reservation_expires_at <= clock_timestamp() AS reservation_expired
        FROM refresh_operations.operations
        WHERE kind = 'clan-refresh' AND dedupe_key = ${dedupeKey}
          AND status IN ('awaiting_admission', 'pending', 'leased')
      `
      return active
        ? {
            operationId: active.id,
            awaitingAdmission: active.awaiting_admission,
            reservationExpired: active.reservation_expired,
          }
        : null
    },

    async reserveInteractivePlayerRefresh(
      input: InteractivePlayerRefreshReservation,
    ): Promise<ReserveInteractiveRefreshResult> {
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          await sql`
            UPDATE refresh_operations.operations
            SET status = 'dead_letter', reservation_token = NULL, reservation_expires_at = NULL,
                completed_at = clock_timestamp(), updated_at = clock_timestamp(),
                last_error = ${sql.json({ code: 'admission_reservation_expired', message: 'Admission reservation expired' })}
            WHERE kind = 'interactive-player-refresh' AND dedupe_key = ${input.dedupeKey}
              AND status = 'awaiting_admission' AND reservation_expires_at <= clock_timestamp()
          `
          const operationId = randomUUID()
          const reservationToken = randomUUID()
          const [inserted] = await sql<{ id: string }[]>`
            INSERT INTO refresh_operations.operations
              (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
               status, max_attempts, reservation_token, reservation_expires_at)
            VALUES
              (${operationId}, ${operationId}, 'interactive-player-refresh', ${input.dedupeKey},
               ${input.operationKey}, 'interactive',
               ${sql.json({ brawlhallaId: input.brawlhallaId, staleSections: input.staleSections })},
               ${sql.json(input.provenance)}, 'awaiting_admission', 3, ${reservationToken},
               clock_timestamp() + (${input.reservationTtlSeconds} * interval '1 second'))
            ON CONFLICT (kind, dedupe_key)
              WHERE status IN ('awaiting_admission', 'pending', 'leased')
            DO NOTHING
            RETURNING id
          `
          if (inserted) return { outcome: 'reserved' as const, operationId, reservationToken }
          const [active] = await sql<{ id: string }[]>`
            SELECT id FROM refresh_operations.operations
            WHERE kind = 'interactive-player-refresh' AND dedupe_key = ${input.dedupeKey}
              AND status IN ('awaiting_admission', 'pending', 'leased')
          `
          return active ? { outcome: 'already-active' as const, operationId: active.id } : null
        })
        if (result) return result
      }
    },

    async reserveInteractiveClanRefresh(
      input: InteractiveClanRefreshReservation,
    ): Promise<ReserveInteractiveRefreshResult> {
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          await sql`
            UPDATE refresh_operations.operations
            SET status = 'dead_letter', reservation_token = NULL, reservation_expires_at = NULL,
                completed_at = clock_timestamp(), updated_at = clock_timestamp(),
                last_error = ${sql.json({ code: 'admission_reservation_expired', message: 'Admission reservation expired' })}
            WHERE kind = 'clan-refresh' AND dedupe_key = ${input.dedupeKey}
              AND status = 'awaiting_admission' AND reservation_expires_at <= clock_timestamp()
          `
          const operationId = randomUUID()
          const reservationToken = randomUUID()
          const [inserted] = await sql<{ id: string }[]>`
            INSERT INTO refresh_operations.operations
              (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
               status, max_attempts, reservation_token, reservation_expires_at)
            VALUES
              (${operationId}, ${operationId}, 'clan-refresh', ${input.dedupeKey}, ${input.operationKey}, 'interactive',
               ${sql.json({ clanId: input.clanId, staleSections: input.staleSections })},
               ${sql.json(input.provenance)}, 'awaiting_admission', 3, ${reservationToken},
               clock_timestamp() + (${input.reservationTtlSeconds} * interval '1 second'))
            ON CONFLICT (kind, dedupe_key)
              WHERE status IN ('awaiting_admission', 'pending', 'leased')
            DO NOTHING RETURNING id
          `
          if (inserted) return { outcome: 'reserved' as const, operationId, reservationToken }
          const [active] = await sql<{ id: string }[]>`
            SELECT id FROM refresh_operations.operations
            WHERE kind = 'clan-refresh' AND dedupe_key = ${input.dedupeKey}
              AND status IN ('awaiting_admission', 'pending', 'leased')
          `
          return active ? { outcome: 'already-active' as const, operationId: active.id } : null
        })
        if (result) return result
      }
    },

    async activateInteractiveRefresh(operationId: string, reservationToken: string): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [updated] = await sql<{ id: string }[]>`
          UPDATE refresh_operations.operations
          SET status = 'pending', reservation_token = NULL, reservation_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = ${operationId} AND kind IN ('interactive-player-refresh', 'clan-refresh')
            AND status = 'awaiting_admission' AND reservation_token = ${reservationToken}
            AND reservation_expires_at > clock_timestamp()
          RETURNING id
        `
        if (!updated) return 'lease-lost' as const
        await sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`
        return 'transitioned' as const
      })
    },

    async activateAdmittedInteractiveRefresh(operationId: string): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [updated] = await sql<{ id: string }[]>`
          UPDATE refresh_operations.operations
          SET status = 'pending', reservation_token = NULL, reservation_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = ${operationId} AND kind IN ('interactive-player-refresh', 'clan-refresh')
            AND status = 'awaiting_admission'
          RETURNING id
        `
        if (!updated) return 'lease-lost' as const
        await sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`
        return 'transitioned' as const
      })
    },

    async rejectInteractiveRefresh(
      operationId: string,
      reservationToken: string,
      reason: string,
    ): Promise<TransitionResult> {
      const [updated] = await client<{ id: string }[]>`
        UPDATE refresh_operations.operations
        SET status = 'dead_letter', reservation_token = NULL, reservation_expires_at = NULL,
            completed_at = clock_timestamp(), updated_at = clock_timestamp(),
            last_error = ${client.json({ code: reason, message: 'Interactive refresh admission rejected' })}
        WHERE id = ${operationId} AND kind IN ('interactive-player-refresh', 'clan-refresh')
          AND status = 'awaiting_admission' AND reservation_token = ${reservationToken}
        RETURNING id
      `
      return updated ? 'transitioned' : 'lease-lost'
    },

    async rejectExpiredInteractiveRefresh(operationId: string): Promise<TransitionResult> {
      const [updated] = await client<{ id: string }[]>`
        UPDATE refresh_operations.operations
        SET status = 'dead_letter', reservation_token = NULL, reservation_expires_at = NULL,
            completed_at = clock_timestamp(), updated_at = clock_timestamp(),
            last_error = ${client.json({ code: 'admission_reservation_expired', message: 'Admission reservation expired' })}
        WHERE id = ${operationId} AND kind IN ('interactive-player-refresh', 'clan-refresh')
          AND status = 'awaiting_admission' AND reservation_expires_at <= clock_timestamp()
        RETURNING id
      `
      return updated ? 'transitioned' : 'lease-lost'
    },

    async accept(input: AcceptOperation): Promise<AcceptOperationResult> {
      const kind = operationKind(input)
      if (kind === 'leaderboard-1v1') {
        if (input.workClass !== 'leaderboard') throw new Error('leaderboard operations require leaderboard work class')
        validateLeaderboardOperationPayload(input.payload as { pageDepth: number; intervalMs: number })
      }
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          const operationId = randomUUID()
          const inserted = await sql<{ id: string }[]>`
            INSERT INTO refresh_operations.operations
              (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
            VALUES
              (${operationId}, ${operationId}, ${kind}, ${input.dedupeKey}, ${input.operationKey}, ${input.workClass},
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
            WHERE kind = ${kind} AND dedupe_key = ${input.dedupeKey} AND status IN ('pending', 'leased')
          `
          return active ? { outcome: 'already-active' as const, operationId: active.id } : null
        })
        if (result) return result
      }
    },

    async createSchedule(input: CreateSchedule): Promise<CreateScheduleResult> {
      const firstDueAt = validateSchedule(input)
      const kind = operationKind(input)
      const scheduleId = randomUUID()
      const [created] = await client<{ id: string }[]>`
        INSERT INTO refresh_operations.schedules
          (id, schedule_key, kind, work_class, interval_ms, first_due_at, next_due_at,
           operation_key_prefix, payload, provenance, max_attempts)
        VALUES
          (${scheduleId}, ${input.scheduleKey}, ${kind}, ${input.workClass}, ${input.intervalMs},
           ${firstDueAt}, ${firstDueAt}, ${input.operationKeyPrefix}, ${client.json(input.payload)},
           ${client.json(input.provenance)}, ${input.maxAttempts ?? 3})
        ON CONFLICT (schedule_key) DO NOTHING
        RETURNING id
      `
      if (created) return { outcome: 'created', scheduleId: created.id }

      const [existing] = await client<{ id: string; matches: boolean }[]>`
        SELECT id,
          kind = ${kind}
          AND work_class = ${input.workClass}
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

    async reconcileLeaderboardSchedule(input: CreateLeaderboardSchedule): Promise<CreateScheduleResult> {
      const firstDueAt = validateSchedule(input)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtext(${input.scheduleKey}))`
        const [existing] = await sql<{ id: string; matches: boolean }[]>`
          SELECT id,
            kind = 'leaderboard-1v1'
            AND work_class = 'leaderboard'
            AND interval_ms = ${input.intervalMs}
            AND first_due_at = ${firstDueAt}
            AND operation_key_prefix = ${input.operationKeyPrefix}
            AND payload = ${sql.json(input.payload)}::jsonb
            AND provenance = ${sql.json(input.provenance)}::jsonb
            AND max_attempts = ${input.maxAttempts ?? 3} AS matches
          FROM refresh_operations.schedules
          WHERE schedule_key = ${input.scheduleKey}
          FOR UPDATE
        `
        if (existing?.matches) return { outcome: 'already-exists' as const, scheduleId: existing.id }
        if (existing) {
          await sql`
            UPDATE refresh_operations.schedules
            SET enabled = false,
                schedule_key = schedule_key || ':retired:' || id::text,
                updated_at = clock_timestamp()
            WHERE id = ${existing.id}
          `
        }
        const scheduleId = randomUUID()
        await sql`
          INSERT INTO refresh_operations.schedules
            (id, schedule_key, kind, work_class, interval_ms, first_due_at, next_due_at,
             operation_key_prefix, payload, provenance, max_attempts)
          VALUES
            (${scheduleId}, ${input.scheduleKey}, 'leaderboard-1v1', 'leaderboard', ${input.intervalMs},
             ${firstDueAt}, ${firstDueAt}, ${input.operationKeyPrefix}, ${sql.json(input.payload)},
             ${sql.json(input.provenance)}, ${input.maxAttempts ?? 3})
        `
        return { outcome: existing ? ('reconciled' as const) : ('created' as const), scheduleId }
      })
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
          SELECT id, schedule_key, kind, work_class, interval_ms, first_due_at, next_window_number,
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
              (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance,
               max_attempts, available_at)
            VALUES
              (${operationId}, ${operationId}, ${schedule.kind}, ${`schedule:${windowIdentity}`},
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
            UPDATE refresh_operations.operations
            SET origin_schedule_occurrence_id = ${occurrenceId}
            WHERE id = ${operationId}
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

    async claim(
      workerId: string,
      leaseMs: number,
      admission: AdmissionConfig,
      kind?: OperationLease['kind'],
    ): Promise<OperationLease | null> {
      validateAdmissionConfig(admission)
      const policy = admissionConfigHash(admission)
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          const kindFilter = kind ? sql`AND kind = ${kind}` : sql``
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
            WHERE ((status = 'pending' AND available_at <= clock_timestamp())
               OR (status = 'leased' AND lease_expires_at <= clock_timestamp()))
              ${kindFilter}
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
            SELECT operation.id, operation.effect_operation_id, operation.kind, operation.operation_key,
                   operation.work_class, operation.payload, operation.provenance, operation.lease_owner,
                   operation.lease_token, operation.attempt_count, operation.max_attempts, operation.status,
                   (
                     SELECT occurrence.window_due_at
                       + (occurrence.missed_window_count * schedule.interval_ms) * interval '1 millisecond'
                     FROM refresh_operations.schedule_occurrences occurrence
                     JOIN refresh_operations.schedules schedule ON schedule.id = occurrence.schedule_id
                     WHERE occurrence.id = operation.origin_schedule_occurrence_id
                   ) AS scheduled_window_at
            FROM refresh_operations.operations operation
            WHERE operation.work_class = ${selectedClass}
              AND ((operation.status = 'pending' AND operation.available_at <= clock_timestamp())
                OR (operation.status = 'leased' AND operation.lease_expires_at <= clock_timestamp()))
              ${kindFilter}
            ORDER BY operation.available_at, operation.created_at, operation.id
            FOR UPDATE OF operation SKIP LOCKED
            LIMIT 1
          `
          if (!candidate) return { kind: 'retry' as const }

          if (candidate.status === 'leased') {
            const [proofEffect] =
              candidate.kind === 'proof'
                ? await sql<{ operation_id: string }[]>`
                    SELECT operation_id FROM refresh_operations.proof_effects
                    WHERE operation_id = ${candidate.effect_operation_id}
                  `
                : []
            const [leaderboardEffect] =
              candidate.kind === 'leaderboard-1v1'
                ? await sql<{ operation_id: string }[]>`
                    SELECT operation_id FROM refresh_operations.leaderboard_effects
                    WHERE operation_id = ${candidate.effect_operation_id}
                  `
                : []
            const [interactiveEffect] =
              candidate.kind === 'interactive-player-refresh' || candidate.kind === 'clan-refresh'
                ? await sql<{ complete: boolean }[]>`
                    SELECT NOT EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements_text(operation.payload -> 'staleSections') AS required(section)
                      WHERE NOT EXISTS (
                        SELECT 1
                        FROM refresh_operations.interactive_refresh_effects effect
                        WHERE effect.operation_id = operation.effect_operation_id AND effect.section = required.section
                      )
                    ) AS complete
                    FROM refresh_operations.operations operation
                    WHERE operation.id = ${candidate.id}
                  `
                : []
            if (proofEffect || leaderboardEffect || interactiveEffect?.complete) {
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
            RETURNING id, effect_operation_id, operation_key, kind, work_class, payload, provenance,
                      lease_owner, lease_token, attempt_count, max_attempts, status
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
          return {
            kind: 'leased' as const,
            lease: toLease({ ...leased, scheduled_window_at: candidate.scheduled_window_at }),
          }
        })
        if (result.kind === 'leased') return result.lease
        if (result.kind === 'empty') return null
      }
    },

    async listAwaitingInteractiveRefreshes(): Promise<string[]> {
      const rows = await client<{ id: string }[]>`
        SELECT id FROM refresh_operations.operations
        WHERE kind IN ('interactive-player-refresh', 'clan-refresh') AND status = 'awaiting_admission'
        ORDER BY created_at, id
        LIMIT 100
      `
      return rows.map(({ id }) => id)
    },

    async renew(lease: OperationLease, leaseMs: number): Promise<'renewed' | 'lease-lost'> {
      const renewed = await renewalClient<{ id: string }[]>`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = ${lease.operationId} AND status = 'leased'
          AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `
      return renewed[0] ? 'renewed' : 'lease-lost'
    },

    async renewWithAuthority(lease: OperationLease, leaseMs: number) {
      const [renewed] = await renewalClient<{ lease_expires_at: Date }[]>`
        UPDATE refresh_operations.operations
        SET lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = ${lease.operationId} AND status = 'leased'
          AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING lease_expires_at
      `
      return renewed
        ? ({ outcome: 'renewed', leaseExpiresAt: renewed.lease_expires_at } as const)
        : ({ outcome: 'lease-lost' } as const)
    },

    async beginInteractiveSection(
      lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
      section: 'ranked' | 'stats' | 'profile' | 'roster',
    ) {
      const [owned] = await client<{ completed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM refresh_operations.interactive_refresh_effects
          WHERE operation_id = ${lease.effectOperationId} AND section = ${section}
        ) AS completed
        FROM refresh_operations.operations
        WHERE id = ${lease.operationId} AND status = 'leased'
          AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
          AND lease_expires_at > clock_timestamp()
      `
      if (!owned) return 'lease-lost' as const
      return owned.completed ? ('already-applied' as const) : ('execute' as const)
    },

    async commitInteractiveSection(
      lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
      section: 'ranked' | 'stats' | 'profile' | 'roster',
    ): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<{ id: string }[]>`
          SELECT id FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        await sql`
          INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
          VALUES (${lease.effectOperationId}, ${section}, ${lease.leaseToken})
          ON CONFLICT (operation_id, section) DO NOTHING
        `
        return 'transitioned' as const
      })
    },

    async commitProofEffect(lease: Extract<OperationLease, { kind: 'proof' }>): Promise<FencedResult> {
      if (lease.kind !== 'proof') throw new Error('commitProofEffect requires a proof operation')
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<
          {
            id: string
            effect_operation_id: string
            operation_key: string
            payload: { value: string }
          }[]
        >`
          SELECT id, effect_operation_id, operation_key, payload FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND kind = 'proof' AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        const inserted = await sql<{ operation_key: string }[]>`
          INSERT INTO refresh_operations.proof_effects
            (operation_key, operation_id, lease_token, effect_value)
          VALUES (${owned.operation_key}, ${owned.effect_operation_id}, ${lease.leaseToken}, ${sql.json(owned.payload)})
          ON CONFLICT (operation_key) DO NOTHING
          RETURNING operation_key
        `
        if (inserted[0]) return 'applied' as const
        const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
          SELECT operation_id, effect_value = ${sql.json(owned.payload)}::jsonb AS matches_payload
          FROM refresh_operations.proof_effects
          WHERE operation_key = ${owned.operation_key}
        `
        return existing?.operation_id === owned.effect_operation_id && existing.matches_payload
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

    async listDeadLetters(input: { limit?: number; cursor?: string } = {}): Promise<DeadLetterPage> {
      const limit = input.limit ?? 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('limit must be an integer between 1 and 100')
      }
      const cursorFilter = input.cursor
        ? client`AND (operation.completed_at, operation.id) < (
            SELECT completed_at, id FROM refresh_operations.operations WHERE id = ${input.cursor}
          )`
        : client``
      const rows = await client<DeadLetterListRow[]>`
        SELECT operation.id, operation.kind, operation.operation_key, operation.work_class,
               operation.provenance, operation.attempt_count, operation.max_attempts,
               operation.last_error, operation.completed_at, action.disposition
        FROM refresh_operations.operations operation
        LEFT JOIN refresh_operations.dead_letter_actions action
          ON action.target_operation_id = operation.id
        WHERE operation.status = 'dead_letter' ${cursorFilter}
        ORDER BY operation.completed_at DESC, operation.id DESC
        LIMIT ${limit + 1}
      `
      const pageRows = rows.slice(0, limit)
      const items = pageRows.map(toDeadLetterListItem)
      return {
        items,
        nextCursor: rows.length > limit ? (pageRows.at(-1)?.id ?? null) : null,
      }
    },

    async inspectDeadLetter(operationId: string): Promise<DeadLetterInspection | null> {
      return client.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [row] = await sql<
          (DeadLetterListRow & {
            effect_operation_id: string
            dedupe_key: string
            payload_version: number
            payload: OperationLease['payload']
            replayed_from_operation_id: string | null
          })[]
        >`
        SELECT operation.id, operation.effect_operation_id, operation.kind, operation.dedupe_key,
               operation.operation_key, operation.work_class, operation.payload_version,
               operation.payload, operation.provenance, operation.attempt_count,
               operation.max_attempts, operation.last_error, operation.completed_at,
               operation.replayed_from_operation_id, action.disposition
        FROM refresh_operations.operations operation
        LEFT JOIN refresh_operations.dead_letter_actions action
          ON action.target_operation_id = operation.id
        WHERE operation.id = ${operationId} AND operation.status = 'dead_letter'
      `
        if (!row) return null

        const [attempts, proofEffects, interactiveEffects, leaderboardEffects, scheduleRows, actionRows] =
          await Promise.all([
            sql<
              {
                attempt_number: number
                lease_token: string | number
                lease_owner: string
                started_at: Date
                finished_at: Date | null
                outcome: 'succeeded' | 'retry' | 'dead_letter' | 'lease_expired' | null
                error: OperationFailure | null
              }[]
            >`
          SELECT attempt_number, lease_token, lease_owner, started_at, finished_at, outcome, error
          FROM refresh_operations.attempts
          WHERE operation_id = ${operationId}
          ORDER BY attempt_number
        `,
            sql<{ operation_key: string; effect_value: { value: string }; created_at: Date }[]>`
          SELECT operation_key, effect_value, created_at
          FROM refresh_operations.proof_effects
          WHERE operation_id = ${row.effect_operation_id}
          ORDER BY created_at
        `,
            sql<
              {
                section: 'ranked' | 'stats' | 'profile' | 'roster'
                lease_token: string | number
                completed_at: Date
              }[]
            >`
          SELECT section, lease_token, completed_at
          FROM refresh_operations.interactive_refresh_effects
          WHERE operation_id = ${row.effect_operation_id}
          ORDER BY section
        `,
            sql<{ operation_key: string; lease_token: string | number; created_at: Date }[]>`
          SELECT operation_key, lease_token, created_at
          FROM refresh_operations.leaderboard_effects
          WHERE operation_id = ${row.effect_operation_id}
          ORDER BY created_at
        `,
            sql<
              {
                schedule_id: string
                schedule_key: string
                first_window_number: string | number
                last_window_number: string | number
                window_due_at: Date
                materialized_at: Date
                lateness_ms: string | number
                missed_window_count: string | number
                catch_up: boolean
              }[]
            >`
          SELECT occurrence.schedule_id, schedule.schedule_key, occurrence.first_window_number,
                 occurrence.last_window_number, occurrence.window_due_at, occurrence.materialized_at,
                 occurrence.lateness_ms, occurrence.missed_window_count, occurrence.catch_up
          FROM refresh_operations.operations operation
          JOIN refresh_operations.schedule_occurrences occurrence
            ON occurrence.id = operation.origin_schedule_occurrence_id
          JOIN refresh_operations.schedules schedule ON schedule.id = occurrence.schedule_id
          WHERE operation.id = ${operationId}
        `,
            sql<
              {
                id: string
                target_operation_id: string
                disposition: DeadLetterDisposition
                actor_id: string
                reason: string
                occurred_at: Date
                replay_operation_id: string | null
              }[]
            >`
          SELECT id, target_operation_id, disposition, actor_id, reason, occurred_at, replay_operation_id
          FROM refresh_operations.dead_letter_actions
          WHERE target_operation_id = ${operationId}
          ORDER BY occurred_at, id
        `,
          ])
        const schedule = scheduleRows[0]
        return {
          operation: {
            ...toDeadLetterListItem(row),
            dedupeKey: row.dedupe_key,
            payload: row.payload,
            payloadVersion: row.payload_version,
            replayedFromOperationId: row.replayed_from_operation_id,
          },
          attempts: attempts.map((attempt) => ({
            attemptNumber: attempt.attempt_number,
            leaseToken: Number(attempt.lease_token),
            leaseOwner: attempt.lease_owner,
            startedAt: attempt.started_at.toISOString(),
            finishedAt: attempt.finished_at?.toISOString() ?? null,
            outcome: attempt.outcome,
            error: attempt.error,
          })),
          proofEffects: proofEffects.map((effect) => ({
            operationKey: effect.operation_key,
            effectValue: effect.effect_value,
            createdAt: effect.created_at.toISOString(),
          })),
          interactiveEffects: interactiveEffects.map((effect) => ({
            section: effect.section,
            leaseToken: Number(effect.lease_token),
            completedAt: effect.completed_at.toISOString(),
          })),
          leaderboardEffects: leaderboardEffects.map((effect) => ({
            operationKey: effect.operation_key,
            leaseToken: Number(effect.lease_token),
            createdAt: effect.created_at.toISOString(),
          })),
          schedule: schedule
            ? {
                scheduleId: schedule.schedule_id,
                scheduleKey: schedule.schedule_key,
                firstWindowNumber: Number(schedule.first_window_number),
                lastWindowNumber: Number(schedule.last_window_number),
                windowDueAt: schedule.window_due_at.toISOString(),
                materializedAt: schedule.materialized_at.toISOString(),
                latenessMs: Number(schedule.lateness_ms),
                missedWindowCount: Number(schedule.missed_window_count),
                catchUp: schedule.catch_up,
              }
            : null,
          auditActions: actionRows.map((action) => ({
            actionId: action.id,
            targetOperationId: action.target_operation_id,
            disposition: action.disposition,
            actorId: action.actor_id,
            reason: action.reason,
            occurredAt: action.occurred_at.toISOString(),
            replayOperationId: action.replay_operation_id,
          })),
        }
      })
    },

    replayDeadLetter(input: DeadLetterDispositionInput) {
      return disposeDeadLetter('replayed', input)
    },

    discardDeadLetter(input: DeadLetterDispositionInput) {
      return disposeDeadLetter('discarded', input)
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
      const leaderboardEffects = await client`
        SELECT * FROM refresh_operations.leaderboard_effects WHERE operation_id = ${operationId}
      `
      return { operation, attempts, effects, leaderboardEffects }
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
      if (renewalClient === client) {
        await client.end()
        return
      }
      await Promise.all([client.end(), renewalClient.end()])
    },
  }
}

export type PostgresRefreshOperations = ReturnType<typeof createPostgresRefreshOperations>

export function createPostgresDeadLetterOperations(
  connectionString: string,
): DeadLetterOperations & { close(): Promise<void> } {
  const operations = createPostgresRefreshOperations(connectionString)
  return {
    listDeadLetters: operations.listDeadLetters,
    inspectDeadLetter: operations.inspectDeadLetter,
    replayDeadLetter: operations.replayDeadLetter,
    discardDeadLetter: operations.discardDeadLetter,
    close: operations.close,
  }
}

export type PostgresDeadLetterOperations = ReturnType<typeof createPostgresDeadLetterOperations>
