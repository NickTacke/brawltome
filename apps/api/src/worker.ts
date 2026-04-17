import { BhApiClient } from '@brawltome/bhapi'
import { processRefreshClan } from '@brawltome/clan'
import { db } from '@brawltome/database'
import { createPlayerLinkRepo, resolveSteamLink } from '@brawltome/identity'
import { processRefreshRanked, processRefreshStats } from '@brawltome/player'
import { startJanitor } from '@brawltome/ranking'
import { createMetricsRegistry, createQueue, initGameData } from '@brawltome/shared'
import Redis from 'ioredis'

const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) {
  throw new Error('BRAWLHALLA_API_KEY environment variable is required')
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
// Each blocking consumer needs its own connection to avoid XREADGROUP serialization
const newRedis = () => new Redis(redisUrl)
const bhapi = new BhApiClient({ apiKey })
const deps = { db, bhapi }
const playerLinkRepo = createPlayerLinkRepo(db)

const metricsRedis = newRedis()
const metrics = createMetricsRegistry(metricsRedis)

const rankedQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  newRedis(),
  'refresh-ranked',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-ranked START: ${data.brawlhallaId} (caller=${data.caller})`)
    await processRefreshRanked(deps, data.brawlhallaId, data.caller ?? 'background')
    console.log(`[queue] refresh-ranked DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 3,
    retries: 3,
    backoffMs: 1000,
    maxDepth: 2000,
    dedupKey: (d) => String(d.brawlhallaId),
    priorityRatio: 3,
    metrics,
  },
)

const statsQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  newRedis(),
  'refresh-stats',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-stats START: ${data.brawlhallaId} (caller=${data.caller})`)
    await processRefreshStats(deps, data.brawlhallaId, data.caller ?? 'background')
    console.log(`[queue] refresh-stats DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 2,
    retries: 3,
    backoffMs: 1000,
    maxDepth: 2000,
    dedupKey: (d) => String(d.brawlhallaId),
    priorityRatio: 3,
    metrics,
  },
)

const clanQueue = createQueue<{ clanId: number; caller: 'on-demand' | 'background' }>(
  newRedis(),
  'refresh-clan',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-clan START: ${data.clanId} (caller=${data.caller})`)
    await processRefreshClan(deps, data.clanId, data.caller ?? 'background')
    console.log(`[queue] refresh-clan DONE: ${data.clanId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 1,
    retries: 3,
    backoffMs: 1000,
    maxDepth: 1000,
    dedupKey: (d) => String(d.clanId),
    priorityRatio: 3,
    metrics,
  },
)

const steamLinkQueue = createQueue<{ userId: string; steamId: string; caller: 'background' }>(
  newRedis(),
  'resolve-steam',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] resolve-steam START: userId=${data.userId}`)
    await resolveSteamLink({ playerLinkRepo, bhapi }, data)
    console.log(`[queue] resolve-steam DONE: userId=${data.userId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 1,
    retries: 2,
    backoffMs: 1000,
    maxDepth: 500,
    dedupKey: (d) => `${d.userId}:${d.steamId}`,
    metrics,
  },
)

let bhapiMetricsTimer: Timer | null = null
let bhapiMetricsStopped = false

async function snapBhapiMetrics() {
  try {
    await metrics.setScalar('bhapi:tokens_on_demand_remaining', bhapi.remainingTokens('on-demand'))
    await metrics.setScalar('bhapi:tokens_background_remaining', bhapi.remainingTokens('background'))
    await metrics.setScalar('bhapi:paused_until_ms', bhapi.pausedUntilMs)
  } catch (err) {
    console.error('[worker] bhapi metrics snapshot error:', err)
  } finally {
    if (!bhapiMetricsStopped) {
      bhapiMetricsTimer = setTimeout(snapBhapiMetrics, 5000)
    }
  }
}

bhapiMetricsTimer = setTimeout(snapBhapiMetrics, 5000)

console.log('Worker starting...')
await initGameData(db, bhapi)
Promise.all([rankedQueue.start(), statsQueue.start(), clanQueue.start(), steamLinkQueue.start()]).catch(console.error)

const stopJanitor =
  process.env.DISABLE_JANITOR === '1'
    ? async () => {}
    : startJanitor({ db, bhapi, redis: newRedis(), rankedQueue, statsQueue, clanQueue, metrics })

process.on('SIGINT', async () => {
  console.log('Worker shutting down...')
  bhapiMetricsStopped = true
  if (bhapiMetricsTimer) clearTimeout(bhapiMetricsTimer)
  rankedQueue.stop()
  statsQueue.stop()
  clanQueue.stop()
  steamLinkQueue.stop()
  await stopJanitor()
  await metricsRedis.quit().catch(() => {})
  console.log('Lock released. Goodbye.')
  process.exit(0)
})

console.log(
  'Worker running. Queues: refresh-ranked(3), refresh-stats(2), refresh-clan(1), resolve-steam(1). Janitor active.',
)
