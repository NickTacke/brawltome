import type { OperationFailure } from '../model'
import {
  failureDetails,
  SourceAdmissionLimitedError,
  type SourceDomain,
  sourceRetryAfterMs,
  unavailableSourceDomain,
} from './job-errors'

export type DeferCategory = 'admission_deferred' | 'source_rate_limited' | 'source_unavailable'

export type RetryTimings = {
  retryDelayMs: number
  sourceUnavailableRetryMs: number
}

export type FailureDecision =
  | { action: 'lease-lost' }
  | { action: 'complete' }
  | { action: 'retry-applied-effect' }
  | {
      action: 'defer'
      failure: OperationFailure
      delayMs: number
      category: DeferCategory
      pauseSource?: { domain: SourceDomain; seconds: number }
    }
  | {
      action: 'fail'
      failure: OperationFailure
      delayMs: number
      category: 'execution' | 'source_rate_limited' | 'source_unavailable'
      pauseSource?: { domain: SourceDomain; seconds: number }
    }

const minimumSourceWaitMs = 60_000

export function retryDelayForAttempt(
  attemptNumber: number,
  policy: { baseDelayMs: number; multiplier: number; maxDelayMs: number; jitterRatio: number; random: () => number },
): number {
  const exponent = Math.max(0, attemptNumber - 1)
  const nominal = policy.baseDelayMs * policy.multiplier ** exponent
  const jitter = 1 + policy.jitterRatio * (2 * policy.random() - 1)

  return Math.max(0, Math.min(policy.maxDelayMs, Math.floor(nominal * jitter)))
}

export function sourceWaitMs(retry: RetryTimings): number {
  return Math.max(minimumSourceWaitMs, retry.sourceUnavailableRetryMs, retry.retryDelayMs)
}

// for a job whose own failure branch has to wait until the source checks have had their say
export function isSourceFailure(error: unknown): boolean {
  return error instanceof SourceAdmissionLimitedError || unavailableSourceDomain(error) !== null
}

export function decideSourceFailure(error: unknown, retry: RetryTimings): FailureDecision | null {
  if (error instanceof SourceAdmissionLimitedError) {
    return {
      action: 'defer',
      failure: failureDetails(error, 'source_rate_limited'),
      delayMs: error.retryAfterSeconds * 1_000,
      category: 'admission_deferred',
    }
  }

  const domain = unavailableSourceDomain(error)

  if (!domain) return null

  const delayMs = sourceWaitMs(retry)

  return {
    action: 'defer',
    failure: failureDetails(error, 'source_unavailable'),
    delayMs,
    category: 'source_unavailable',
    pauseSource: { domain, seconds: Math.ceil(delayMs / 1_000) },
  }
}

// for a job that keeps its own record of each source call: the attempt stays spent, so the next call gets a new number
export function decideCountedSourceOutage(
  error: unknown,
  delayMs: number,
  retry: RetryTimings,
): FailureDecision | null {
  const domain = unavailableSourceDomain(error)

  if (!domain) return null

  return {
    action: 'fail',
    failure: failureDetails(error, 'source_unavailable'),
    delayMs,
    category: 'source_unavailable',
    pauseSource: { domain, seconds: Math.ceil(sourceWaitMs(retry) / 1_000) },
  }
}

export function decideExecutionFailure(error: unknown, failureCode: string, delayMs: number): FailureDecision {
  const sourceRetryMs = sourceRetryAfterMs(error)

  if (sourceRetryMs !== null) {
    return {
      action: 'fail',
      failure: failureDetails(error, 'source_rate_limited'),
      delayMs: sourceRetryMs,
      category: 'source_rate_limited',
    }
  }

  return { action: 'fail', failure: failureDetails(error, failureCode), delayMs, category: 'execution' }
}
