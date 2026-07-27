import type { Database } from '@brawltome/database'
import type { MetricsRegistry, Queue } from '@brawltome/shared'
import { checkRateLimit } from '@brawltome/shared'
import type { Redis } from 'ioredis'
import { createPlayerRepo } from '../player.repo'

interface DiscoverDeps {
  db: Database
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  statsQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  clientIp: string
  metrics?: MetricsRegistry
}

export async function discoverPlayer(deps: DiscoverDeps, brawlhallaId: number): Promise<{ isRefreshing: boolean }> {
  const { db, redis, rankedQueue, statsQueue, clientIp, metrics } = deps

  const globalLimit = await checkRateLimit(redis, 'global', 'discovery:global', metrics)
  if (!globalLimit.allowed) return { isRefreshing: false }

  const discoveryLimit = await checkRateLimit(redis, clientIp, 'discovery', metrics)
  if (!discoveryLimit.allowed) return { isRefreshing: false }

  const repo = createPlayerRepo(db)
  await repo.createPlaceholder(brawlhallaId)

  console.log(`[discover] enqueuing ${brawlhallaId} via priority queue`)
  const rankedAccepted = await rankedQueue.enqueue({ brawlhallaId, caller: 'on-demand' }, true)
  const statsAccepted = await statsQueue.enqueue({ brawlhallaId, caller: 'on-demand' }, true)

  return { isRefreshing: rankedAccepted || statsAccepted }
}
