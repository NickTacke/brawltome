import { JobLeaseLostError } from '@brawltome/queue'
import { classifySourceFailure } from '../domain/source-failure'
import type { ClanSource } from './refresh-clan'

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

async function waitBeforeRetry(fetcher: GuildStatsFetcher, retry: number, error: unknown): Promise<void> {
  const delayMs = guildRetryDelaysMs[retry]

  if (delayMs === undefined || isRateLimited(error)) throw error

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
 * guild's error; a rate limit or a lost lease is thrown, since it's about the whole run rather than this guild.
 */
export async function fetchGuildStats(fetcher: GuildStatsFetcher, clanId: number): Promise<GuildStatsFetch> {
  try {
    const payload = await fetchWithRetries(fetcher, clanId)

    return { payload }
  } catch (error) {
    if (error instanceof JobLeaseLostError || isRateLimited(error)) throw error

    return { error }
  }
}
