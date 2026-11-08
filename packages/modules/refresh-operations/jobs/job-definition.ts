import type { Sql } from '@brawltome/foundation'
import type { FailureDecision } from '../domain/failure-decision'
import type { SourceDomain } from '../domain/job-errors'
import type {
  AdmissionConfig,
  LeaseAuthorityResult,
  OperationFailure,
  OperationProvenance,
  RefreshOperationWorker,
  RenewResult,
  SectionCheckpointResult,
  TransitionResult,
  WorkClass,
} from '../model'

export type EffectState = 'none' | 'applied' | 'acknowledged'

export type AttemptOutcome = 'succeeded' | 'retry' | 'dead_letter' | 'lease_lost'

export type Lease<Payload> = {
  operationId: string
  effectOperationId: string
  effectCreatedAt: string
  operationKey: string
  provenance: OperationProvenance
  leaseOwner: string
  leaseToken: number
  attemptNumber: number
  maxAttempts: number
  scheduleWindowAt: string | null
  kind: string
  workClass: WorkClass
  payload: Payload
}

export type LeaseWatcher = {
  renewed(leaseExpiresAt: Date): Promise<void>
  lost(): Promise<void>
}

// jobs hold a Lease of their own payload; the queue only reads the lease's identity and fence
export type LeaseOperations = Pick<RefreshOperationWorker, 'commitProofEffect'> & {
  renew(lease: Lease<unknown>, leaseMs: number): Promise<RenewResult>
  renewWithAuthority(lease: Lease<unknown>, leaseMs: number): Promise<LeaseAuthorityResult>
  beginInteractiveSection(lease: Lease<unknown>, section: string): Promise<SectionCheckpointResult>
  commitInteractiveSection(lease: Lease<unknown>, section: string): Promise<TransitionResult>
  retryAppliedEffect(lease: Lease<unknown>, retryDelayMs: number): Promise<TransitionResult>
  defer(lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number): Promise<TransitionResult>
  complete(lease: Lease<unknown>): Promise<TransitionResult>
  fail(lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number): Promise<TransitionResult>
}

export type QueueWorker = LeaseOperations & {
  claim(workerId: string, leaseMs: number, admission: AdmissionConfig, kind?: string): Promise<Lease<unknown> | null>
}

export type SourceAdmitter = (domain: SourceDomain) => Promise<void>

// the part of request-admission the dispatcher calls; declaring the module as a dependency would force every test
// that loads this one alone to migrate it too
export type SourceAdmissionPort = {
  admitSource(input: {
    domain: SourceDomain
    reservationKey: string
    units: number
    caller?: 'on-demand' | 'background'
  }): Promise<{ outcome: 'admitted' } | { outcome: 'rate-limited'; retryAfterSeconds: number }>
  pauseSource(domain: SourceDomain, retryAfterSeconds: number): Promise<void>
}

export type JobTools = {
  queue: LeaseOperations
  leaseMs: number
  retryDelayMs: number
  // aborts when the lease is lost
  signal: AbortSignal
  createSourceAdmitter(section: string): SourceAdmitter
  watchLease(watcher: LeaseWatcher): () => void
}

export type JobDefinition<Payload> = {
  kind: string
  workClasses: readonly WorkClass[]
  failureCode: string
  parsePayload(value: unknown): Payload
  run(lease: Lease<Payload>, tools: JobTools): Promise<AttemptOutcome>
  // reads inside claim's transaction when a lease has expired
  effectState?(
    transaction: Sql,
    lease: Pick<Lease<Payload>, 'operationId' | 'effectOperationId' | 'payload'>,
  ): Promise<EffectState>
  // held for the rest of claim's transaction, on every claim of this kind
  claimLockKey?(effectOperationId: string): string
  decideFailure?(error: unknown, lease: Lease<Payload>): Promise<FailureDecision | null>
}

export function defineJob<Payload>(definition: JobDefinition<Payload>): JobDefinition<Payload> {
  return definition
}
