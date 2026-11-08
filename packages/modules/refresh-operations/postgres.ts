import { randomUUID } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { acceptOperation } from './db/accept-operation'
import {
  activateAdmitted,
  activateBound,
  activateReserved,
  rejectExpired,
  rejectReserved,
} from './db/activate-operation'
import { admissionLockId } from './db/admission-lock'
import { claimOperation } from './db/claim-operation'
import { createSchedule } from './db/create-schedule'
import { disableFixedSchedule } from './db/disable-fixed-schedule'
import { disposeDeadLetter } from './db/dispose-dead-letter'
import type { EffectStates } from './db/effect-states'
import { findActiveOperation, listAwaiting } from './db/find-operations'
import { inspectDeadLetter } from './db/inspect-dead-letter'
import { inspectOperation } from './db/inspect-operation'
import { inspectSchedule } from './db/inspect-schedule'
import { inspectTelemetry } from './db/inspect-telemetry'
import { listDeadLetters } from './db/list-dead-letters'
import { materializeDueSchedules } from './db/materialize-due-schedules'
import { promotePendingWorkClass } from './db/promote-work-class'
import { readOperationStatus } from './db/read-operation-status'
import { reconcileFixedSchedule } from './db/reconcile-fixed-schedule'
import { renewLease, renewLeaseWithAuthority } from './db/renew-lease'
import { reserveForAdmission, reserveForBinding } from './db/reserve-operation'
import { beginSection, commitSection } from './db/section-checkpoints'
import { completeOperation, deferOperation, failOperation, retryAppliedEffect } from './db/settle-operation'
import type { Transaction } from './db/transaction'
import { wakeupChannel } from './db/wakeup'
import { admissionConfigHash, validateAdmissionConfig } from './domain/admission'
import { isDiscoveryProjectionKind, isLeaderboardKind } from './domain/operation-kinds'
import {
  type PrimaryMonitoringScheduleDefinition,
  validatePrimaryMonitoringSchedule,
} from './domain/schedule-definition'
import type { Lease } from './jobs/job-definition'
import {
  type AcceptOperation,
  type AcceptOperationResult,
  type AdmissionConfig,
  type CreateLeaderboardDeepCrawlSchedule,
  type CreateLeaderboardSchedule,
  type CreateSchedule,
  type DeadLetterDispositionInput,
  type DeadLetterOperations,
  type FencedResult,
  type FreshnessAttempt,
  freshnessPlannerSource,
  type InteractivePlayerRefreshReservation,
  interactiveRefreshMaxAttempts,
  type ListDeadLettersInput,
  type OperationFailure,
  type OperationLease,
  type PlayerRefreshSettled,
  type PrimaryMonitoringSnapshot,
  parsePlayerRefreshSettled,
  playerRefreshSettledChannel,
  primaryMonitoringIntervalMs,
  type ReconcilePrimaryMonitoringResult,
  type RefreshRequestDemand,
  type ReserveInteractiveRefreshResult,
  type ReserveStatisticsCollection,
  type ReserveStatisticsLegendMetaPublication,
  type ReserveStatisticsPublication,
  recentlyViewedCohort,
  statisticsCollectionKinds,
  type TransitionResult,
  validateLeaderboardOperationPayload,
} from './model'

const interactiveRefreshKinds = ['interactive-player-refresh', 'clan-refresh'] as const

function playerResourceKey(brawlhallaId: number): string {
  return `player:${brawlhallaId}`
}

export type RefreshOperationsDatabases = {
  database: Database
  // lease renewals run here so a busy main pool can never let a running lease expire; defaults to database
  renewals?: Database
}

export function createPostgresRefreshOperations(
  { database, renewals = database }: RefreshOperationsDatabases,
  options: { effectStates?: EffectStates } = {},
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

    findActiveInteractivePlayerRefresh(dedupeKey: string, brawlhallaId?: number) {
      return findActiveOperation(database, {
        kind: 'interactive-player-refresh',
        dedupeKey,
        resourceKey: brawlhallaId ? playerResourceKey(brawlhallaId) : undefined,
      })
    },

    reserveInteractivePlayerRefresh(
      input: InteractivePlayerRefreshReservation,
    ): Promise<ReserveInteractiveRefreshResult> {
      const resourceKey = playerResourceKey(input.brawlhallaId)

      const reservation = {
        kind: 'interactive-player-refresh' as const,
        dedupeKey: input.dedupeKey,
        operationKey: input.operationKey,
        resourceKey,
        workClass: 'interactive' as const,
        payload: { brawlhallaId: input.brawlhallaId, staleSections: input.staleSections },
        provenance: input.provenance,
        maxAttempts: interactiveRefreshMaxAttempts,
        reservationTtlSeconds: input.reservationTtlSeconds,
      }

      // A visitor outranks the background: a queued recently viewed refresh for this player becomes interactive
      // work, so the visitor waits on interactive priority instead of behind the monitoring queue.
      const promoteRecentlyViewed = (transaction: Transaction) =>
        promotePendingWorkClass(transaction, {
          kind: 'interactive-player-refresh',
          resourceKey,
          from: 'primary-monitoring',
          to: 'interactive',
          payloadEquals: { cohort: recentlyViewedCohort },
        })

      return reserveForAdmission(database, reservation, { beforeInsert: promoteRecentlyViewed })
    },

    activateInteractiveRefresh(operationId: string, reservationToken: string): Promise<TransitionResult> {
      return activateReserved(database, { operationId, reservationToken, kinds: interactiveRefreshKinds })
    },

    activateAdmittedInteractiveRefresh(operationId: string): Promise<TransitionResult> {
      return activateAdmitted(database, { operationId, kinds: interactiveRefreshKinds })
    },

    rejectInteractiveRefresh(operationId: string, reservationToken: string, reason: string): Promise<TransitionResult> {
      return rejectReserved(database, {
        operationId,
        reservationToken,
        reason,
        message: 'Interactive refresh admission rejected',
        kinds: interactiveRefreshKinds,
      })
    },

    rejectExpiredInteractiveRefresh(operationId: string): Promise<TransitionResult> {
      return rejectExpired(database, { operationId, kinds: interactiveRefreshKinds })
    },

    async reserveStatisticsCollection(input: ReserveStatisticsCollection): Promise<AcceptOperationResult> {
      if (input.dedupeKey !== input.operationKey) {
        throw new Error('statistics collection dedupeKey must equal its stable operationKey')
      }

      if (input.workClass !== 'global-statistics') {
        throw new Error('statistics collection requires global-statistics work class')
      }

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.payload.cohortId)) {
        throw new Error('statistics collection cohortId must be a UUID')
      }

      if (!Number.isSafeInteger(input.payload.brawlhallaId) || input.payload.brawlhallaId <= 0) {
        throw new Error('statistics collection brawlhallaId must be a positive safe integer')
      }

      return reserveForBinding(database, {
        ...input,
        operationKeyKinds: statisticsCollectionKinds,
        lockNamespace: 209,
        mismatchMessage: 'statistics collection operation key has a different definition',
      })
    },

    listAwaitingStatisticsCollections(): Promise<string[]> {
      return listAwaiting(database, { kinds: statisticsCollectionKinds, status: 'awaiting_binding', limit: 500 })
    },

    activateStatisticsCollection(operationId: string): Promise<TransitionResult> {
      return activateBound(database, operationId, { kinds: statisticsCollectionKinds })
    },

    async reserveStatisticsPublication(input: ReserveStatisticsPublication): Promise<AcceptOperationResult> {
      if (input.dedupeKey !== input.operationKey) {
        throw new Error('statistics publication dedupeKey must equal its stable operationKey')
      }

      if (input.workClass !== 'global-statistics') {
        throw new Error('statistics publication requires global-statistics work class')
      }

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.payload.generationId)
      ) {
        throw new Error('statistics publication generationId must be a UUID')
      }

      if (input.payload.product !== 'ranked' && input.payload.product !== 'lifetime') {
        throw new Error('statistics publication product is unsupported')
      }

      return reserveForBinding(database, {
        ...input,
        lockNamespace: 210,
        mismatchMessage: 'statistics publication operation key has a different definition',
      })
    },

    listAwaitingStatisticsPublications(): Promise<string[]> {
      return listAwaiting(database, { kinds: ['statistics-publication'], status: 'awaiting_binding', limit: 100 })
    },

    activateStatisticsPublication(operationId: string): Promise<TransitionResult> {
      return activateBound(database, operationId, { kinds: ['statistics-publication'] })
    },

    async reserveStatisticsLegendMetaPublication(
      input: ReserveStatisticsLegendMetaPublication,
    ): Promise<AcceptOperationResult> {
      if (input.dedupeKey !== input.operationKey) {
        throw new Error('Statistics Legend Meta publication dedupeKey must equal its stable operationKey')
      }

      if (input.workClass !== 'global-statistics') {
        throw new Error('Statistics Legend Meta publication requires global-statistics work class')
      }

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.payload.generationId)
      ) {
        throw new Error('Statistics Legend Meta publication generationId must be a UUID')
      }

      return reserveForBinding(database, {
        ...input,
        lockNamespace: 211,
        mismatchMessage: 'Statistics Legend Meta operation key has a different definition',
      })
    },

    listAwaitingStatisticsLegendMetaPublications(): Promise<string[]> {
      return listAwaiting(database, {
        kinds: ['statistics-legend-meta-publication'],
        status: 'awaiting_binding',
        limit: 100,
      })
    },

    activateStatisticsLegendMetaPublication(operationId: string): Promise<TransitionResult> {
      return activateBound(database, operationId, { kinds: ['statistics-legend-meta-publication'] })
    },

    // Distinct days on which site or Discord visitors requested a player's refresh. Overlay lookups and requests that
    // were rate limited or abandoned are not someone reading the profile.
    async refreshRequestDemand(input: { windowDays: number }): Promise<RefreshRequestDemand[]> {
      const rows = await client<{ brawlhalla_id: number; view_days: number }[]>`
        SELECT (payload->>'brawlhallaId')::integer AS brawlhalla_id,
               count(DISTINCT (created_at AT TIME ZONE 'UTC')::date)::integer AS view_days
        FROM refresh_operations.operations
        WHERE kind = 'interactive-player-refresh' AND work_class = 'interactive'
          AND created_at > clock_timestamp() - make_interval(days => ${input.windowDays})
          AND provenance->>'source' IN ('interactive-api', 'discord')
          AND coalesce(last_error->>'code', '') NOT IN ('actor_rate_limited', 'admission_reservation_expired')
        GROUP BY 1
      `

      return rows.map((row) => ({ brawlhallaId: row.brawlhalla_id, viewDays: row.view_days }))
    },

    async recentFreshnessAttempts(input: { windowDays: number }): Promise<FreshnessAttempt[]> {
      const rows = await client<{ brawlhalla_id: number; last_planned_at: Date; last_failed_at: Date | null }[]>`
        SELECT (payload->>'brawlhallaId')::integer AS brawlhalla_id,
               max(created_at) AS last_planned_at,
               max(created_at) FILTER (WHERE status = 'dead_letter') AS last_failed_at
        FROM refresh_operations.operations
        WHERE kind = 'interactive-player-refresh' AND provenance->>'source' = ${freshnessPlannerSource}
          AND created_at > clock_timestamp() - make_interval(days => ${input.windowDays})
        GROUP BY 1
      `

      return rows.map((row) => ({
        brawlhallaId: row.brawlhalla_id,
        lastPlannedAt: row.last_planned_at,
        lastFailedAt: row.last_failed_at,
      }))
    },

    async activeRecentlyViewedRefreshes(): Promise<number> {
      const [row] = await client<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM refresh_operations.operations
        WHERE kind = 'interactive-player-refresh' AND work_class = 'primary-monitoring'
          AND payload->>'cohort' = ${recentlyViewedCohort}
          AND status IN ('awaiting_admission', 'pending', 'leased')
      `

      return row.count
    },

    // Enqueues background refreshes and returns the players it enqueued. A player with any active refresh (a
    // visitor's included) is skipped: the active-resource index allows one at a time.
    async enqueueRecentlyViewedRefreshes(brawlhallaIds: readonly number[]): Promise<number[]> {
      const enqueued: number[] = []

      for (const brawlhallaId of brawlhallaIds) {
        if (!Number.isSafeInteger(brawlhallaId) || brawlhallaId < 1 || brawlhallaId > 2_147_483_647) {
          throw new Error('recently viewed refresh brawlhallaId must be a positive 32-bit integer')
        }

        const operationId = randomUUID()

        const inserted = await client<{ id: string }[]>`
          INSERT INTO refresh_operations.operations
            (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
          VALUES
            (${operationId}, ${operationId}, 'interactive-player-refresh', ${`freshness:${brawlhallaId}`},
             ${`freshness:${brawlhallaId}:${operationId}`}, 'primary-monitoring',
             ${client.json({ cohort: recentlyViewedCohort, brawlhallaId, staleSections: ['ranked', 'stats'] })},
             ${client.json({ source: freshnessPlannerSource })}, ${interactiveRefreshMaxAttempts})
          ON CONFLICT DO NOTHING
          RETURNING id
        `

        if (!inserted[0]) continue

        await client`SELECT pg_notify(${wakeupChannel}, ${operationId})`
        enqueued.push(brawlhallaId)
      }

      return enqueued
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

    async reconcilePrimaryMonitoring(snapshot: PrimaryMonitoringSnapshot): Promise<ReconcilePrimaryMonitoringResult> {
      if (!(snapshot.observedAt instanceof Date) || Number.isNaN(snapshot.observedAt.getTime())) {
        throw new Error('Primary monitoring snapshot requires a valid observedAt')
      }

      const definitions = snapshot.targets.map((target) => {
        const definition: PrimaryMonitoringScheduleDefinition = {
          kind: 'interactive-player-refresh' as const,
          scheduleKey: `primary-player:${target.brawlhallaId}:${target.assignmentId}`,
          operationKeyPrefix: `primary-player:${target.brawlhallaId}`,
          resourceKey: `player:${target.brawlhallaId}`,
          workClass: 'primary-monitoring' as const,
          intervalMs: primaryMonitoringIntervalMs,
          firstDueAt: new Date(target.verifiedAt.getTime() + primaryMonitoringIntervalMs).toISOString(),
          payload: {
            assignmentId: target.assignmentId,
            brawlhallaId: target.brawlhallaId,
            staleSections: ['ranked', 'stats'] as ['ranked', 'stats'],
          },
          provenance: { source: 'primary-player-monitoring', requestedBy: 'issue-208' },
          maxAttempts: 3,
        }

        validatePrimaryMonitoringSchedule(definition)

        return definition
      })

      if (new Set(definitions.map(({ resourceKey }) => resourceKey)).size !== definitions.length) {
        throw new Error('Primary monitoring snapshot contains duplicate players')
      }

      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client

        await sql`SELECT pg_advisory_xact_lock(${208_192})`

        const [previous] = await sql<{ observed_at: Date }[]>`
          SELECT observed_at
          FROM refresh_operations.primary_monitoring_reconciliation
          WHERE singleton
          FOR UPDATE
        `

        if (previous && previous.observed_at.getTime() >= snapshot.observedAt.getTime()) {
          return { created: 0, retired: 0 }
        }

        const existing = await sql<
          {
            id: string
            schedule_key: string
            resource_key: string | null
            first_due_at: Date
            payload: { assignmentId?: string; brawlhallaId?: number }
          }[]
        >`
          SELECT id, schedule_key, resource_key, first_due_at, payload
          FROM refresh_operations.schedules
          WHERE provenance ->> 'source' = 'primary-player-monitoring' AND enabled
          FOR UPDATE
        `

        const desiredByResource = new Map(definitions.map((definition) => [definition.resourceKey, definition]))
        let retired = 0

        for (const schedule of existing) {
          const desired = schedule.resource_key ? desiredByResource.get(schedule.resource_key) : undefined

          const matches =
            desired &&
            schedule.schedule_key === desired.scheduleKey &&
            schedule.first_due_at.getTime() === new Date(desired.firstDueAt).getTime() &&
            schedule.payload.assignmentId === desired.payload.assignmentId &&
            schedule.payload.brawlhallaId === desired.payload.brawlhallaId

          if (matches) {
            desiredByResource.delete(desired.resourceKey)
            continue
          }

          await sql`
            UPDATE refresh_operations.schedules
            SET enabled = false,
                schedule_key = schedule_key || ':retired:' || id::text,
                updated_at = clock_timestamp()
            WHERE id = ${schedule.id}
          `

          retired++
        }

        let created = 0

        for (const definition of desiredByResource.values()) {
          await sql`
            INSERT INTO refresh_operations.schedules
              (id, schedule_key, kind, resource_key, work_class, interval_ms, first_due_at, next_due_at,
               operation_key_prefix, payload, provenance, max_attempts)
            VALUES
              (${randomUUID()}, ${definition.scheduleKey}, ${definition.kind}, ${definition.resourceKey},
               ${definition.workClass}, ${definition.intervalMs}, ${definition.firstDueAt}, ${definition.firstDueAt},
               ${definition.operationKeyPrefix}, ${sql.json(definition.payload)},
               ${sql.json(definition.provenance)}, ${definition.maxAttempts})
          `

          created++
        }

        await sql`
          INSERT INTO refresh_operations.primary_monitoring_reconciliation (singleton, observed_at)
          VALUES (true, ${snapshot.observedAt})
          ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
        `

        return { created, retired }
      })
    },

    createSchedule: (input: CreateSchedule) => createSchedule(database, input),

    reconcileLeaderboardSchedule: (input: CreateLeaderboardSchedule) =>
      reconcileFixedSchedule(database, { schedule: input }),

    // 1v1 progress stays in the original per-region table; the other modes use the per-mode table.
    async readLeaderboardDeepCrawlProgress(
      mode: string,
      region: string,
    ): Promise<{ windowAt: Date; nextPage: number; totalPages: number } | null> {
      const [row] =
        mode === '1v1'
          ? await client<{ window_at: Date; next_page: number; total_pages: number }[]>`
              SELECT window_at, next_page, total_pages
              FROM refresh_operations.leaderboard_deep_crawl_progress WHERE region = ${region}
            `
          : await client<{ window_at: Date; next_page: number; total_pages: number }[]>`
              SELECT window_at, next_page, total_pages
              FROM refresh_operations.leaderboard_deep_crawl_mode_progress WHERE mode = ${mode} AND region = ${region}
            `

      return row ? { windowAt: row.window_at, nextPage: row.next_page, totalPages: row.total_pages } : null
    },

    async saveLeaderboardDeepCrawlProgress(input: {
      mode: string
      region: string
      windowAt: Date
      nextPage: number
      totalPages: number
    }): Promise<void> {
      if (input.mode === '1v1') {
        await client`
          INSERT INTO refresh_operations.leaderboard_deep_crawl_progress (region, window_at, next_page, total_pages)
          VALUES (${input.region}, ${input.windowAt}, ${input.nextPage}, ${input.totalPages})
          ON CONFLICT (region) DO UPDATE SET
            window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
            total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
        `

        return
      }

      await client`
        INSERT INTO refresh_operations.leaderboard_deep_crawl_mode_progress
          (mode, region, window_at, next_page, total_pages)
        VALUES (${input.mode}, ${input.region}, ${input.windowAt}, ${input.nextPage}, ${input.totalPages})
        ON CONFLICT (mode, region) DO UPDATE SET
          window_at = EXCLUDED.window_at, next_page = EXCLUDED.next_page,
          total_pages = EXCLUDED.total_pages, updated_at = clock_timestamp()
      `
    },

    reconcileLeaderboardDeepCrawlSchedule: (input: CreateLeaderboardDeepCrawlSchedule) =>
      reconcileFixedSchedule(database, { schedule: input, reenable: true }),

    disableLeaderboardDeepCrawlSchedule: (scheduleKey: string) =>
      disableFixedSchedule(database, { scheduleKey, kind: 'leaderboard-deep-crawl' }),

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

    listDeadLetters: (input?: ListDeadLettersInput) => listDeadLetters(database, input),

    inspectDeadLetter: (operationId: string) => inspectDeadLetter(database, operationId),

    replayDeadLetter: (input: DeadLetterDispositionInput) =>
      disposeDeadLetter(database, { ...input, disposition: 'replayed' }),

    discardDeadLetter: (input: DeadLetterDispositionInput) =>
      disposeDeadLetter(database, { ...input, disposition: 'discarded' }),

    inspectTelemetry: () => inspectTelemetry(database),

    operationStatus: (operationId: string) => readOperationStatus(database, operationId),

    inspect: (operationId: string) => inspectOperation(database, operationId),

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

export function createPostgresDeadLetterOperations(database: Database): DeadLetterOperations {
  return {
    listDeadLetters: (input) => listDeadLetters(database, input),

    inspectDeadLetter: (operationId) => inspectDeadLetter(database, operationId),

    replayDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'replayed' }),

    discardDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'discarded' }),
  }
}
