import type { SeasonStartContract } from '@brawltome/contracts'

type ReadSeasonStarts = () => Promise<SeasonStartContract[]>

const cacheLifetimeMs = 60 * 60 * 1000

/** One read of the whole rating history per hour at most. A failed refresh keeps serving the last good answer. */
export function createSeasonStartsCache(read: ReadSeasonStarts, nowMs: () => number = Date.now): ReadSeasonStarts {
  let cached: { seasons: SeasonStartContract[]; readAtMs: number } | null = null

  return async () => {
    if (cached && nowMs() - cached.readAtMs < cacheLifetimeMs) return cached.seasons

    try {
      cached = { seasons: await read(), readAtMs: nowMs() }

      return cached.seasons
    } catch (error) {
      if (cached) return cached.seasons

      throw error
    }
  }
}
