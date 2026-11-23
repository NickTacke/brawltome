import { type FailureDecision, failureDetails } from '@brawltome/queue'
import { BrawltoolsHttpError, BrawltoolsNetworkError, BrawltoolsRateLimitError } from '../source/brawltools-client'

// a Retry-After of hours would stall every esports job that long; ten minutes is the most the worker waits on one
const maxRateLimitPauseSeconds = 10 * 60

const unavailableStatuses = [502, 503, 504]

/** Brawltools is down or never answered, so asking again soon would only fail again. */
export function isBrawltoolsUnavailable(error: unknown): boolean {
  if (error instanceof BrawltoolsNetworkError) return true

  return error instanceof BrawltoolsHttpError && unavailableStatuses.includes(error.status)
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
