import {
  type FailureDecision,
  failureDetails,
  JobLeaseLostError,
  type RetryTimings,
  sourceWaitMs,
} from '@brawltome/queue'
import { classifySourceFailure } from '../domain/source-failure'

// thrown after a slice so the job gives the maintenance slot back; deferring it spends no attempt
export class ClanWeeklySnapshotYield extends Error {
  constructor(weekStarting: string) {
    super(`clan weekly snapshot for week ${weekStarting} yielded between slices`)
  }
}

// thrown when guilds in a row fail every retry, which is V1 being down rather than any one guild
export class ClanWeeklySnapshotSourceDown extends Error {
  constructor(weekStarting: string, failedGuilds: number, lastError: unknown) {
    const lastMessage = lastError instanceof Error ? lastError.message : 'unknown source failure'

    super(`clan weekly snapshot for week ${weekStarting}: ${failedGuilds} guilds in a row failed, last: ${lastMessage}`)
  }
}

// thrown when admission itself fails, which is the queue's database and not V1, so the normal retry rules take it
export class ClanWeeklySnapshotAdmissionFailed extends Error {
  constructor(cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : 'unknown admission failure'

    super(`clan weekly snapshot source admission failed: ${causeMessage}`, { cause })
  }
}

/**
 * Defers a yield, an outage and a 429, so none of them spends an attempt. Unlike the dispatcher's own source rule,
 * an outage doesn't pause V1: the run only knows its own calls failed, and a pause would hold every other caller.
 * null leaves the error to the dispatcher's source and execution rules.
 */
export function decideSnapshotFailure(error: unknown, retry: RetryTimings): FailureDecision | null {
  if (error instanceof JobLeaseLostError) return { action: 'lease-lost' }

  if (error instanceof ClanWeeklySnapshotYield) {
    const failure = { code: 'clan_weekly_snapshot_yield', message: error.message, retryable: true }

    return { action: 'defer', failure, delayMs: 0, category: 'admission_deferred' }
  }

  if (error instanceof ClanWeeklySnapshotSourceDown) {
    const failure = { code: 'clan_weekly_snapshot_source_down', message: error.message, retryable: true }

    return { action: 'defer', failure, delayMs: sourceWaitMs(retry), category: 'source_unavailable' }
  }

  if (classifySourceFailure(error).outcome !== 'source-rate-limited') return null

  const failure = failureDetails(error, 'source_rate_limited')

  return { action: 'defer', failure, delayMs: sourceWaitMs(retry), category: 'source_rate_limited' }
}
