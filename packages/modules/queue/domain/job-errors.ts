import type { OperationFailure } from '../model'

// the sources the worker can pause; matches request-admission, which this module may not depend on
export type SourceDomain = 'brawlhalla-v0' | 'brawlhalla-v1'

export class SourceAdmissionLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Source admission is rate limited')
  }
}

export class JobLeaseLostError extends Error {}

// Brawlhalla answers 502/503/504 during maintenance and outages. Find such an error anywhere in the cause chain so
// the attempt can wait for the source instead of spending retries in seconds and dead-lettering.
export function unavailableSourceDomain(error: unknown): SourceDomain | null {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === 'object' &&
      'status' in current &&
      (current.status === 502 || current.status === 503 || current.status === 504) &&
      'domain' in current &&
      (current.domain === 'brawlhalla-v0' || current.domain === 'brawlhalla-v1')
    ) {
      return current.domain
    }

    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined
  }

  return null
}

export function sourceRetryAfterMs(error: unknown): number | null {
  if (error instanceof SourceAdmissionLimitedError) return error.retryAfterSeconds * 1_000

  if (
    typeof error === 'object' &&
    error !== null &&
    'retryAfterMs' in error &&
    typeof error.retryAfterMs === 'number' &&
    Number.isFinite(error.retryAfterMs)
  ) {
    return Math.max(0, error.retryAfterMs)
  }

  return null
}

export function failureDetails(error: unknown, fallbackCode: string): OperationFailure {
  if (error && typeof error === 'object') {
    return {
      code: 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode,
      message: 'message' in error && typeof error.message === 'string' ? error.message : 'Unknown operation failure',
      retryable: !('retryable' in error) || error.retryable !== false,
    }
  }

  return { code: fallbackCode, message: 'Unknown operation failure', retryable: true }
}
