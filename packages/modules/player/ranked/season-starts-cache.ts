import type { SeasonStartContract } from '@brawltome/contracts'
import { createReadCache } from '../read-cache'

type ReadSeasonStarts = () => Promise<SeasonStartContract[]>

const cacheLifetimeMs = 60 * 60 * 1000

/** One read of the whole rating history per hour at most. A failed refresh keeps serving the last good answer. */
export function createSeasonStartsCache(read: ReadSeasonStarts, nowMs: () => number = Date.now): ReadSeasonStarts {
  return createReadCache(read, cacheLifetimeMs, nowMs)
}
