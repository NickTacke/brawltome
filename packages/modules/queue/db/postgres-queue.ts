import type { Database } from '@brawltome/foundation'
import type { ProofEffectStore } from '../jobs/complete-with-proof-effect'
import type { Lease } from '../jobs/job-definition'
import {
  type AdmissionConfig,
  type CreateSchedule,
  type OperationFailure,
  type OperationLease,
  type PlayerRefreshSettled,
  parsePlayerRefreshSettled,
  playerRefreshSettledChannel,
  type TransitionResult,
} from '../model'
import { type AcceptOperationInput, acceptOperation } from './accept-operation'
import { activateAdmitted } from './activate-operation'
import { type ClaimJob, createClaimJobs } from './claim-jobs'
import { claimOperation, type InvalidRow } from './claim-operation'
import { commitProofEffect } from './commit-proof-effect'
import { configureAdmission } from './configure-admission'
import { createSchedule } from './create-schedule'
import { discoveryLeaseActive } from './discovery-lease-active'
import { inspectOperation } from './inspect-operation'
import { inspectSchedule } from './inspect-schedule'
import { inspectTelemetry } from './inspect-telemetry'
import { listAwaitingInteractiveRefreshes } from './list-awaiting-interactive-refreshes'
import { type AppliedLeaderboardEffects, materializeDueSchedules } from './materialize-due-schedules'
import { readOperationStatus } from './read-operation-status'
import { renewLease, renewLeaseWithAuthority } from './renew-lease'
import { beginSection, commitSection } from './section-checkpoints'
import { completeOperation, deferOperation, failOperation, retryAppliedEffect } from './settle-operation'
import { wakeupChannel } from './wakeup'

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
    configureAdmission: (admission: AdmissionConfig) => configureAdmission(database, admission),

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

    listAwaitingInteractiveRefreshes: () => listAwaitingInteractiveRefreshes(database),

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

    commitProofEffect: (lease: Lease<{ value: string }>) => commitProofEffect(database, lease, options.proofEffects),

    discoveryLeaseActive: (lease: Lease<unknown>) => discoveryLeaseActive(database, lease),

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
