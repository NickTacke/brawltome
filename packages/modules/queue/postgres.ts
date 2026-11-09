import type { Database } from '@brawltome/foundation'
import { type AcceptOperationInput, acceptOperation } from './db/accept-operation'
import { activateAdmitted } from './db/activate-operation'
import { admissionLockId } from './db/admission-lock'
import { type ClaimJob, createClaimJobs } from './db/claim-jobs'
import { claimOperation, type InvalidRow } from './db/claim-operation'
import { createSchedule } from './db/create-schedule'
import type { DeadLetterHooks } from './db/dead-letter-hooks'
import { disposeDeadLetter } from './db/dispose-dead-letter'
import { inspectDeadLetter } from './db/inspect-dead-letter'
import { inspectOperation } from './db/inspect-operation'
import { inspectSchedule } from './db/inspect-schedule'
import { inspectTelemetry } from './db/inspect-telemetry'
import { listDeadLetters } from './db/list-dead-letters'
import { type AppliedLeaderboardEffects, materializeDueSchedules } from './db/materialize-due-schedules'
import { readOperationStatus } from './db/read-operation-status'
import { renewLease, renewLeaseWithAuthority } from './db/renew-lease'
import { beginSection, commitSection } from './db/section-checkpoints'
import { completeOperation, deferOperation, failOperation, retryAppliedEffect } from './db/settle-operation'
import { wakeupChannel } from './db/wakeup'
import { admissionConfigHash, validateAdmissionConfig } from './domain/admission'
import type { ProofEffectStore } from './jobs/complete-with-proof-effect'
import type { Lease } from './jobs/job-definition'
import {
  type AdmissionConfig,
  type CreateSchedule,
  type DeadLetterOperations,
  type FencedResult,
  type OperationFailure,
  type OperationLease,
  type PlayerRefreshSettled,
  parsePlayerRefreshSettled,
  playerRefreshSettledChannel,
  type TransitionResult,
} from './model'

const interactiveRefreshKinds = ['interactive-player-refresh', 'clan-refresh'] as const

export type RefreshOperationsDatabases = {
  database: Database
  // lease renewals run here so a busy main pool can never let a running lease expire; defaults to database
  renewals?: Database
}

export function createPostgresRefreshOperations(
  { database, renewals = database }: RefreshOperationsDatabases,
  options: {
    // every job the worker can run; claim needs them, so a queue built without them can only write
    jobs?: readonly ClaimJob[]
    // an unknown kind has no dead-letter metric series, so this is the only signal one was settled
    onInvalidRow?: (row: InvalidRow) => void
    proofEffects?: ProofEffectStore
    readAppliedLeaderboardEffects?: AppliedLeaderboardEffects
  } = {},
) {
  const client = database.sql
  const claimJobs = options.jobs && createClaimJobs(options.jobs)

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

    activateAdmittedInteractiveRefresh(operationId: string): Promise<TransitionResult> {
      return activateAdmitted(database, { operationId, kinds: interactiveRefreshKinds })
    },

    accept: <Payload>(input: AcceptOperationInput<Payload>) => acceptOperation(database, input),

    createSchedule: (input: CreateSchedule) => createSchedule(database, input),

    materializeDueSchedules: (limit = 100) =>
      materializeDueSchedules(database, {
        limit,
        readAppliedLeaderboardEffects: options.readAppliedLeaderboardEffects,
      }),

    async claim(
      workerId: string,
      leaseMs: number,
      admission: AdmissionConfig,
      kind?: string,
    ): Promise<OperationLease | null> {
      // without them every due row would look like a kind no job runs
      if (!claimJobs) throw new Error(`claim operation for worker ${workerId}: queue was built without jobs`)

      return claimOperation(database, {
        workerId,
        leaseMs,
        admission,
        kind,
        jobs: claimJobs,
        onInvalidRow: options.onInvalidRow,
      })
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

    renew: (lease: OperationLease, leaseMs: number) => renewLease(renewals, lease, leaseMs),

    renewWithAuthority: (lease: OperationLease, leaseMs: number) => renewLeaseWithAuthority(renewals, lease, leaseMs),

    beginInteractiveSection: (
      lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
      section: 'ranked' | 'stats' | 'profile' | 'roster',
    ) => beginSection(database, lease, section),

    commitInteractiveSection: (
      lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
      section: 'ranked' | 'stats' | 'profile' | 'roster',
    ) => commitSection(database, lease, section),

    async commitProofEffect(lease: Lease<{ value: string }>): Promise<FencedResult> {
      if (lease.kind !== 'proof' && lease.kind !== 'primary-player-verification') {
        throw new Error('commitProofEffect requires a proof operation')
      }

      const proofEffects = options.proofEffects

      if (!proofEffects) {
        throw new Error(`commit proof effect for operation ${lease.operationId}: no proof effect writer was configured`)
      }

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
          WHERE id = ${lease.operationId} AND kind = ${lease.kind} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `

        if (!owned) return 'lease-lost' as const

        return proofEffects.write(sql, {
          operationKey: owned.operation_key,
          effectOperationId: owned.effect_operation_id,
          leaseToken: lease.leaseToken,
          payload: owned.payload,
        })
      })
    },

    async discoveryLeaseActive(lease: Lease<unknown>): Promise<boolean> {
      const [result] = await client<{ active: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND kind = ${lease.kind} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
        ) AS active
      `

      return result.active
    },

    retryAppliedEffect: (lease: Lease<unknown>, retryDelayMs: number) =>
      retryAppliedEffect(database, lease, retryDelayMs),

    defer: (lease: OperationLease, failure: OperationFailure, retryDelayMs: number) =>
      deferOperation(database, lease, failure, retryDelayMs),

    complete: (lease: OperationLease) => completeOperation(database, lease),

    fail: (lease: OperationLease, failure: OperationFailure, retryDelayMs: number) =>
      failOperation(database, lease, failure, retryDelayMs),

    inspectTelemetry: () => inspectTelemetry(database),

    operationStatus: (operationId: string) => readOperationStatus(database, operationId),

    inspect: (operationId: string) => inspectOperation(database, operationId, options.proofEffects),

    inspectSchedule: (scheduleId: string) => inspectSchedule(database, scheduleId),

    listen(onWakeup: (operationId: string) => void) {
      return client.listen(wakeupChannel, onWakeup)
    },

    // Shares the client's single LISTEN connection. onListen runs on the first LISTEN and after every reconnect, when
    // notifications sent while the connection was down are lost.
    listenPlayerRefreshSettled(onSettled: (event: PlayerRefreshSettled) => void, onListen?: () => void) {
      return client.listen(
        playerRefreshSettledChannel,
        (payload) => {
          const event = parsePlayerRefreshSettled(payload)

          if (event) onSettled(event)
        },
        onListen,
      )
    },
  }
}

export type PostgresRefreshOperations = ReturnType<typeof createPostgresRefreshOperations>

export function createPostgresDeadLetterOperations(database: Database, hooks: DeadLetterHooks): DeadLetterOperations {
  return {
    listDeadLetters: (input) => listDeadLetters(database, input),

    inspectDeadLetter: (operationId) => inspectDeadLetter(database, operationId, hooks),

    replayDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'replayed' }, hooks),

    discardDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'discarded' }, hooks),
  }
}
