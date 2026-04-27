import type { MetricsRegistry, Queue } from '@brawltome/shared'
import { checkRateLimit, dedupKey, tryDedup } from '@brawltome/shared'
import type { Redis } from 'ioredis'
import { DEDUP_TTL_CLAN_SEC } from '../clan'

interface DiscoverDeps {
  redis: Redis
  clanQueue: Queue<{ clanId: number; caller: 'on-demand' | 'background' }>
  clientIp: string
  metrics?: MetricsRegistry
}

export async function discoverClan(deps: DiscoverDeps, clanId: number): Promise<{ isRefreshing: boolean }> {
  const { redis, clanQueue, clientIp, metrics } = deps

  const globalLimit = await checkRateLimit(redis, 'global', 'discovery:global', metrics)
  if (!globalLimit.allowed) return { isRefreshing: false }

  const discoveryLimit = await checkRateLimit(redis, clientIp, 'discovery', metrics)
  if (!discoveryLimit.allowed) return { isRefreshing: false }

  const canDedup = await tryDedup(redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
  if (!canDedup) return { isRefreshing: true }

  console.log(`[discover] enqueuing clan ${clanId} via priority queue`)
  await clanQueue.enqueue({ clanId, caller: 'on-demand' }, true)

  return { isRefreshing: true }
}
