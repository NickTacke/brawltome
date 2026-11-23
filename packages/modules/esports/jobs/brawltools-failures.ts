import { type FailureDecision, failureDetails, SourceAdmissionLimitedError } from '@brawltome/queue'
import { BrawltoolsHttpError, BrawltoolsNetworkError, BrawltoolsRateLimitError } from '../source/brawltools-client'

// a Retry-After of hours would stall every esports job that long; ten minutes is the most the worker waits on one
const maxRateLimitPauseSeconds = 10 * 60

/** Brawltools said 429, or our own budget for it is spent; either way the job waits and runs again soon. */
export function isBrawltoolsRateLimited(error: unknown): boolean {
  return error instanceof BrawltoolsRateLimitError || error instanceof SourceAdmissionLimitedError
}

/** Brawltools is down or never answered, so asking again soon would only fail again. */
export function isBrawltoolsUnavailable(error: unknown): boolean {
  if (error instanceof BrawltoolsNetworkError) return true

  return error instanceof BrawltoolsHttpError && error.status >= 500
}

/** Brawltools turned the request down (a 4xx other than 429), so asking again would get the same answer. */
export function isBrawltoolsRejected(error: unknown): boolean {
  if (error instanceof BrawltoolsRateLimitError) return false

  return error instanceof BrawltoolsHttpError && error.status >= 400 && error.status < 500
}

/**
 * A 429 pauses the brawltools source, so the other esports jobs wait too, and puts this job back without spending
 * an attempt. Every other failure is left to the queue.
 */
export async function decideBrawltoolsFailure(error: unknown): Promise<FailureDecision | null> {
  if (!(error instanceof BrawltoolsRateLimitError)) return null

  const seconds = Math.min(error.retryAfterSeconds, maxRateLimitPauseSeconds)

  return {
    action: 'defer',
    failure: failureDetails(error, 'source_rate_limited'),
    delayMs: seconds * 1_000,
    category: 'source_rate_limited',
    pauseSource: { domain: 'brawltools', seconds },
  }
}
