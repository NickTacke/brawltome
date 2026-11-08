import type { Database } from '@brawltome/foundation'
import { acceptOperation } from './db/accept-operation'
import { activateAdmitted } from './db/activate-operation'
import { admissionLockId } from './db/admission-lock'
import { claimOperation } from './db/claim-operation'
import { createSchedule } from './db/create-schedule'
import type { DeadLetterHooks } from './db/dead-letter-hooks'
import { disposeDeadLetter } from './db/dispose-dead-letter'
import type { EffectStates } from './db/effect-states'
import { inspectDeadLetter } from './db/inspect-dead-letter'
import { inspectOperation } from './db/inspect-operation'
import { inspectSchedule } from './db/inspect-schedule'
import { inspectTelemetry } from './db/inspect-telemetry'
import { listDeadLetters } from './db/list-dead-letters'
import { materializeDueSchedules } from './db/materialize-due-schedules'
import { readOperationStatus } from './db/read-operation-status'
import { renewLease, renewLeaseWithAuthority } from './db/renew-lease'
import { beginSection, commitSection } from './db/section-checkpoints'
import { completeOperation, deferOperation, failOperation, retryAppliedEffect } from './db/settle-operation'
import { wakeupChannel } from './db/wakeup'
import { admissionConfigHash, validateAdmissionConfig } from './domain/admission'
import { isDiscoveryProjectionKind, isLeaderboardKind } from './domain/operation-kinds'
import type { ProofEffectStore } from './jobs/complete-with-proof-effect'
import type { Lease } from './jobs/job-definition'
import {
  type AcceptOperation,
  type AcceptOperationResult,
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
  validateLeaderboardOperationPayload,
} from './model'

const interactiveRefreshKinds = ['interactive-player-refresh', 'clan-refresh'] as const

export type RefreshOperationsDatabases = {
  database: Database
  // lease renewals run here so a busy main pool can never let a running lease expire; defaults to database
  renewals?: Database
}

export function createPostgresRefreshOperations(
  { database, renewals = database }: RefreshOperationsDatabases,
  options: { effectStates?: EffectStates; proofEffects?: ProofEffectStore } = {},
) {
  const client = database.sql

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

    async accept(input: AcceptOperation): Promise<AcceptOperationResult> {
      const kind = input.kind ?? 'proof'

      if (isLeaderboardKind(kind)) {
        if (input.workClass !== 'leaderboard') throw new Error('leaderboard operations require leaderboard work class')

        validateLeaderboardOperationPayload(input.payload as { pageDepth: number; intervalMs: number })
      } else if (kind === 'ranked-player-pulse') {
        const { brawlhallaId } = input.payload as { brawlhallaId: number }

        if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) {
          throw new Error('ranked player pulse brawlhallaId must be a positive 32-bit integer')
        }
      } else if (kind === 'player-name-verification') {
        const { brawlhallaId, playerName } = input.payload as { brawlhallaId: number; playerName: string }

        if (input.workClass !== 'maintenance')
          throw new Error('player name verification requires maintenance work class')

        if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) {
          throw new Error('player name verification brawlhallaId must be a positive 32-bit integer')
        }

        if (typeof playerName !== 'string' || playerName.length === 0) {
          throw new Error('player name verification playerName must be a non-empty string')
        }
      }

      if (isDiscoveryProjectionKind(kind)) {
        const { batchSize } = input.payload as { batchSize: number }

        if (input.workClass !== 'projection') throw new Error('discovery projection requires projection work class')

        if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
          throw new Error('discovery projection batchSize must be between 1 and 1000')
        }
      }

      if (kind === 'discovery-reconciliation') {
        const { owner } = input.payload as { owner: string }

        if (input.workClass !== 'projection') throw new Error('discovery reconciliation requires projection work class')

        if (owner !== 'player' && owner !== 'clan') throw new Error('discovery reconciliation owner is invalid')
      }

      return acceptOperation(database, {
        kind,
        dedupeKey: input.dedupeKey,
        operationKey: input.operationKey,
        workClass: input.workClass,
        payload: input.payload,
        provenance: input.provenance,
        maxAttempts: input.maxAttempts,
      })
    },

    createSchedule: (input: CreateSchedule) => createSchedule(database, input),

    materializeDueSchedules: (limit = 100) => materializeDueSchedules(database, { limit }),

    async claim(
      workerId: string,
      leaseMs: number,
      admission: AdmissionConfig,
      kind?: OperationLease['kind'],
    ): Promise<OperationLease | null> {
      // without them claim would never finish an acknowledged operation or take its claim lock
      if (!options.effectStates) {
        throw new Error(`claim operation for worker ${workerId}: queue was built without effectStates`)
      }

      return claimOperation(database, { workerId, leaseMs, admission, kind, effectStates: options.effectStates })
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
