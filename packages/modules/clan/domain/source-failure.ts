import { isSourceRecord } from './source-values'

export type SourceFailure = {
  outcome: 'admission-limited' | 'source-rate-limited' | 'ambiguous-failure'
  // the caller rethrows these, so the operation retries after the wait the error names
  isRetryable: boolean
}

/** Sorts a failed source call by the retry delay its error carries, if any. */
export function classifySourceFailure(error: unknown): SourceFailure {
  if (isSourceRecord(error) && Number.isFinite(error.retryAfterSeconds)) {
    return { outcome: 'admission-limited', isRetryable: true }
  }

  if (isSourceRecord(error) && Number.isFinite(error.retryAfterMs)) {
    return { outcome: 'source-rate-limited', isRetryable: true }
  }

  return { outcome: 'ambiguous-failure', isRetryable: false }
}
