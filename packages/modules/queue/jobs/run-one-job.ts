import type { Telemetry } from '@brawltome/telemetry'
import {
  decideExecutionFailure,
  decideSourceFailure,
  type FailureDecision,
  retryDelayForAttempt,
} from '../domain/failure-decision'
import { SourceAdmissionLimitedError, type SourceDomain } from '../domain/job-errors'
import type { AdmissionConfig, OperationFailure, TransitionResult } from '../model'
import type {
  AttemptOutcome,
  JobDefinition,
  JobTools,
  Lease,
  LeaseOperations,
  QueueWorker,
  SourceAdmissionPort,
  SourceAdmitter,
} from './job-definition'
import type { JobRegistry } from './job-registry'
import { startLeaseRenewal } from './lease-renewal'

export type RetryBackoff = {
  multiplier: number
  maxDelayMs: number
  jitterRatio: number
  random?: () => number
}

export type RunOneJobOptions = {
  leaseMs: number
  retryDelayMs: number
  retryBackoff?: RetryBackoff
  sourceUnavailableRetryMs?: number
  admission: AdmissionConfig
  renewEveryMs?: number
  sourceAdmission?: SourceAdmissionPort
  telemetry?: Telemetry
}

type FailureCategory =
  | 'admission_deferred'
  | 'source_rate_limited'
  | 'source_unavailable'
  | 'execution'
  | 'lease_lost'
  | 'unknown'

type AttemptRecord = { outcome: AttemptOutcome; category: FailureCategory }

const safeFailureCode = /^[a-z0-9_.-]{1,64}$/i

const leaseLostSettlement: AttemptRecord = { outcome: 'lease_lost', category: 'lease_lost' }

function recordTelemetry(telemetry: Telemetry | undefined, recording: (active: Telemetry) => void): void {
  if (!telemetry) return

  try {
    recording(telemetry)
  } catch {
    return
  }
}

function executionRetryDelayMs(lease: Lease<unknown>, options: RunOneJobOptions): number {
  if (!options.retryBackoff) return options.retryDelayMs

  return retryDelayForAttempt(lease.attemptNumber, {
    baseDelayMs: options.retryDelayMs,
    multiplier: options.retryBackoff.multiplier,
    maxDelayMs: options.retryBackoff.maxDelayMs,
    jitterRatio: options.retryBackoff.jitterRatio,
    random: options.retryBackoff.random ?? Math.random,
  })
}

async function decideAttemptFailure(
  job: JobDefinition<unknown>,
  claimed: Lease<unknown>,
  parsedLease: Lease<unknown> | null,
  error: unknown,
  options: RunOneJobOptions,
): Promise<FailureDecision> {
  const jobDecision = parsedLease ? await job.decideFailure?.(error, parsedLease) : null

  if (jobDecision) return jobDecision

  const sourceDecision = decideSourceFailure(error, {
    retryDelayMs: options.retryDelayMs,
    sourceUnavailableRetryMs: options.sourceUnavailableRetryMs ?? 60_000,
  })

  if (sourceDecision) return sourceDecision

  return decideExecutionFailure(error, job.failureCode, executionRetryDelayMs(claimed, options))
}

function settledUnlessLeaseLost(transition: TransitionResult, settled: AttemptRecord): AttemptRecord {
  return transition === 'lease-lost' ? leaseLostSettlement : settled
}

// pausing the source holds every other caller too, instead of each discovering the outage on its own
async function pauseSource(options: RunOneJobOptions, pause: { domain: SourceDomain; seconds: number }): Promise<void> {
  try {
    await options.sourceAdmission?.pauseSource(pause.domain, pause.seconds)
  } catch (pauseError) {
    recordTelemetry(options.telemetry, (active) =>
      active.logger.error('source.backoff.persist_failed', pauseError, { domain: pause.domain }),
    )
  }
}

function failedAttemptOutcome(lease: Lease<unknown>, failure: OperationFailure): AttemptOutcome {
  const hasAttemptsLeft = failure.retryable && lease.attemptNumber < lease.maxAttempts

  return hasAttemptsLeft ? 'retry' : 'dead_letter'
}

async function settleFailure(
  queue: LeaseOperations,
  lease: Lease<unknown>,
  options: RunOneJobOptions,
  decision: FailureDecision,
): Promise<AttemptRecord> {
  if (decision.action === 'lease-lost') return leaseLostSettlement

  if (decision.action === 'complete') {
    const transition = await queue.complete(lease)

    return settledUnlessLeaseLost(transition, { outcome: 'succeeded', category: 'unknown' })
  }

  if (decision.action === 'retry-applied-effect') {
    const transition = await queue.retryAppliedEffect(lease, options.retryDelayMs)

    return settledUnlessLeaseLost(transition, { outcome: 'retry', category: 'execution' })
  }

  if (decision.action === 'defer') {
    if (decision.pauseSource) await pauseSource(options, decision.pauseSource)

    const transition = await queue.defer(lease, decision.failure, decision.delayMs)

    return settledUnlessLeaseLost(transition, { outcome: 'retry', category: decision.category })
  }

  if (decision.pauseSource) await pauseSource(options, decision.pauseSource)

  const transition = await queue.fail(lease, decision.failure, decision.delayMs)

  return settledUnlessLeaseLost(transition, {
    outcome: failedAttemptOutcome(lease, decision.failure),
    category: decision.category,
  })
}

function createSourceAdmitter(
  lease: Lease<unknown>,
  section: string,
  sourceAdmission: SourceAdmissionPort | undefined,
): SourceAdmitter {
  let sourceCall = 0

  return async (domain) => {
    const admission = await sourceAdmission?.admitSource({
      domain,
      reservationKey: `${lease.operationId}:${section}:${lease.attemptNumber}:${sourceCall++}`,
      units: 1,
      caller: lease.workClass === 'interactive' ? 'on-demand' : 'background',
    })

    if (!admission) throw new Error('Source admission is unavailable')

    if (admission.outcome === 'rate-limited') throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
  }
}

function withParsedPayload(claimed: Lease<unknown>, job: JobDefinition<unknown>): Lease<unknown> {
  const payload = job.parsePayload(claimed.payload, claimed.workClass)

  return payload === claimed.payload ? claimed : { ...claimed, payload }
}

function attemptLabels(lease: Lease<unknown>) {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    attemptNumber: lease.attemptNumber,
    kind: lease.kind,
    workClass: lease.workClass,
  }
}

async function settleThrownError(
  queue: QueueWorker,
  claimed: Lease<unknown>,
  parsedLease: Lease<unknown> | null,
  job: JobDefinition<unknown>,
  error: unknown,
  attempt: AttemptRecord,
  options: RunOneJobOptions,
): Promise<void> {
  const decision = await decideAttemptFailure(job, claimed, parsedLease, error, options)

  // set before the write so a rejected write still counts as a failed attempt
  if (decision.action === 'fail') {
    attempt.outcome = failedAttemptOutcome(claimed, decision.failure)
    attempt.category = decision.category
  }

  const settlement = await settleFailure(queue, claimed, options, decision)

  attempt.outcome = settlement.outcome
  attempt.category = settlement.category

  if (decision.action !== 'fail') return

  const failureCode = decision.failure.code

  recordTelemetry(options.telemetry, (active) =>
    active.logger.error('operation.attempt.failed', error, {
      ...attemptLabels(claimed),
      outcome: attempt.outcome,
      failureCategory: attempt.category,
      ...(safeFailureCode.test(failureCode) ? { failureCode } : {}),
    }),
  )
}

function recordAttemptCompleted(
  telemetry: Telemetry | undefined,
  lease: Lease<unknown>,
  attempt: AttemptRecord,
  startedAt: number,
): void {
  const labels = { kind: lease.kind, work_class: lease.workClass, outcome: attempt.outcome }

  recordTelemetry(telemetry, (active) => {
    active.metrics.add('operation_attempts_total', 1, labels)
    active.metrics.observe('operation_duration_ms', performance.now() - startedAt, labels)

    if (attempt.outcome !== 'succeeded') {
      active.metrics.add('refresh_failures_total', 1, { kind: lease.kind, failure_category: attempt.category })
    }

    active.logger.info('operation.attempt.completed', {
      ...attemptLabels(lease),
      outcome: attempt.outcome,
      durationMs: performance.now() - startedAt,
    })
  })
}

async function executeAttempt(
  queue: QueueWorker,
  claimed: Lease<unknown>,
  job: JobDefinition<unknown>,
  options: RunOneJobOptions,
): Promise<AttemptOutcome> {
  const startedAt = performance.now()
  const attempt: AttemptRecord = { outcome: 'succeeded', category: 'unknown' }

  recordTelemetry(options.telemetry, (active) =>
    active.logger.info('operation.attempt.started', {
      ...attemptLabels(claimed),
      scheduled: claimed.scheduleWindowAt !== null,
    }),
  )

  const renewEveryMs = options.renewEveryMs ?? Math.max(1, Math.floor(options.leaseMs / 3))
  const renewal = startLeaseRenewal(queue, claimed, options.leaseMs, renewEveryMs)

  const tools: JobTools = {
    queue,
    leaseMs: options.leaseMs,
    retryDelayMs: options.retryDelayMs,
    signal: renewal.leaseLost,
    createSourceAdmitter: (section) => createSourceAdmitter(claimed, section, options.sourceAdmission),
    watchLease: renewal.watchLease,
  }

  let parsedLease: Lease<unknown> | null = null

  try {
    parsedLease = withParsedPayload(claimed, job)
    attempt.outcome = await job.run(parsedLease, tools)

    if (attempt.outcome === 'lease_lost') attempt.category = 'lease_lost'
  } catch (error) {
    await settleThrownError(queue, claimed, parsedLease, job, error, attempt, options)
  } finally {
    await renewal.stop()
    recordAttemptCompleted(options.telemetry, claimed, attempt, startedAt)
  }

  return attempt.outcome
}

export async function runClaimedJob(
  queue: QueueWorker,
  claimed: Lease<unknown>,
  job: JobDefinition<unknown>,
  options: RunOneJobOptions,
): Promise<AttemptOutcome> {
  const telemetry = options.telemetry
  const execute = () => executeAttempt(queue, claimed, job, options)

  if (!telemetry) return execute()

  const context = telemetry.childContext()

  return telemetry.run(context, () =>
    telemetry.trace(
      'operation.attempt',
      { kind: claimed.kind, workClass: claimed.workClass, attemptNumber: claimed.attemptNumber },
      execute,
    ),
  )
}

export async function runOneJob(
  queue: QueueWorker,
  workerId: string,
  registry: JobRegistry,
  options: RunOneJobOptions,
): Promise<boolean> {
  const claimStartedAt = performance.now()
  const claimed = await queue.claim(workerId, options.leaseMs, options.admission)
  const claimDurationMs = performance.now() - claimStartedAt

  recordTelemetry(options.telemetry, (active) =>
    active.metrics.observe('operation_claim_duration_ms', claimDurationMs, { outcome: claimed ? 'claimed' : 'empty' }),
  )

  if (!claimed) return false

  await runClaimedJob(queue, claimed, registry.get(claimed.kind), options)

  return true
}
