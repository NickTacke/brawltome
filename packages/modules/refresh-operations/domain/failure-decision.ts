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
      category: 'execution' | 'source_rate_limited'
    }

const minimumSourceWaitMs = 60_000

/** How long to wait when the source is down or rate limited, never less than a minute. */
export function sourceWaitMs(retry: RetryTimings): number {
  return Math.max(minimumSourceWaitMs, retry.sourceUnavailableRetryMs, retry.retryDelayMs)
}

/** Reads the failure as a signal about the source, or returns null when it says nothing about it. */
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

/** The fallback once nothing more specific matched: fail the attempt, waiting out a source retry-after if given. */
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
