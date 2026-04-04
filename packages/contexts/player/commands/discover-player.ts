import type { Database } from '@brawltome/database'
import type { Queue } from '@brawltome/shared'
import { checkRateLimit, dedupKey, tryDedup } from '@brawltome/shared'
import type { Redis } from 'ioredis'
import { DEDUP_TTL_RANKED_SEC } from '../player'
import { createPlayerRepo } from '../player.repo'

interface DiscoverDeps {
  db: Database
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number }>
  statsQueue: Queue<{ brawlhallaId: number }>
  clientIp: string
}

export async function discoverPlayer(deps: DiscoverDeps, brawlhallaId: number): Promise<{ isRefreshing: boolean }> {
  const { db, redis, rankedQueue, statsQueue, clientIp } = deps

  const globalLimit = await checkRateLimit(redis, 'global', 'discovery:global')
  if (!globalLimit.allowed) return { isRefreshing: false }

  const discoveryLimit = await checkRateLimit(redis, clientIp, 'discovery')
  if (!discoveryLimit.allowed) return { isRefreshing: false }

  const repo = createPlayerRepo(db)
  await repo.createPlaceholder(brawlhallaId)

  const canDedup = await tryDedup(redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
  if (!canDedup) return { isRefreshing: true }

  console.log(`[discover] enqueuing ${brawlhallaId} via priority queue`)
  await rankedQueue.enqueue({ brawlhallaId }, true)
  await statsQueue.enqueue({ brawlhallaId }, true)

  return { isRefreshing: true }
}
