import { JobLeaseLostError, type SourceAdmitter } from '@brawltome/queue'
import { classifySourceFailure } from '../domain/source-failure'
import type { ClanSource } from './refresh-clan'
import { ClanWeeklySnapshotAdmissionFailed } from './weekly-snapshot-failure'

export type GuildStatsFetcher = {
  source: Pick<ClanSource, 'getGuildStatsV1'>
  waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void>
  signal: AbortSignal
}

// null is a 404; an error is a guild that failed every retry
export type GuildStatsFetch = { payload: unknown | null } | { error: unknown }

// the deep crawl's page retries; each retry is a new call, so it goes through admission again
const guildRetryDelaysMs = [500, 2_000] as const

// a 429 or an admission limit means the whole source needs a rest, so the run waits instead of this guild retrying
export function isRateLimited(error: unknown): boolean {
  return classifySourceFailure(error).isRetryable
}

// a rate limit, a failed admission or a lost lease is about the whole run rather than the guild being fetched
function isRunFailure(error: unknown): boolean {
  return (
    error instanceof JobLeaseLostError || error instanceof ClanWeeklySnapshotAdmissionFailed || isRateLimited(error)
  )
}

/** Marks a failure of admission itself, so it isn't taken for V1 failing the guild. A rate limit stays as it is. */
export function markAdmissionFailures(admitSource: SourceAdmitter): SourceAdmitter {
  return async (domain) => {
    try {
      await admitSource(domain)
    } catch (error) {
      if (isRateLimited(error)) throw error

      throw new ClanWeeklySnapshotAdmissionFailed(error)
    }
  }
}

async function waitBeforeRetry(fetcher: GuildStatsFetcher, retry: number, error: unknown): Promise<void> {
  const delayMs = guildRetryDelaysMs[retry]

  if (delayMs === undefined || isRunFailure(error)) throw error

  await fetcher.waitBeforeRetry(delayMs, fetcher.signal)

  if (fetcher.signal.aborted) throw new JobLeaseLostError()
}

async function fetchWithRetries(fetcher: GuildStatsFetcher, clanId: number): Promise<unknown | null> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await fetcher.source.getGuildStatsV1(clanId, { caller: 'background' })
    } catch (error) {
      await waitBeforeRetry(fetcher, retry, error)
    }
  }
}

/**
 * Fetches a guild's stats, retrying a failed call in place. A failure that outlasts the retries comes back as the
 * guild's error; a run failure is thrown.
 */
export async function fetchGuildStats(fetcher: GuildStatsFetcher, clanId: number): Promise<GuildStatsFetch> {
  try {
    const payload = await fetchWithRetries(fetcher, clanId)

    return { payload }
  } catch (error) {
    if (isRunFailure(error)) throw error

    return { error }
  }
}
