import { BhApiClient } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { initGameData } from './services/game-data.service'
import { startJanitor } from './services/janitor.service'
import { processRefreshClan, processRefreshRanked, processRefreshStats } from './services/refresh.service'

const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) {
  throw new Error('BRAWLHALLA_API_KEY environment variable is required')
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
// Each blocking consumer needs its own connection to avoid XREADGROUP serialization
const newRedis = () => new Redis(redisUrl)
const bhapi = new BhApiClient({ apiKey })
const deps = { db, bhapi }

const rankedQueue = createQueue<{ brawlhallaId: number }>(
  newRedis(),
  'refresh-ranked',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-ranked START: ${data.brawlhallaId}`)
    await processRefreshRanked(deps, data.brawlhallaId)
    console.log(`[queue] refresh-ranked DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  { concurrency: 3, retries: 3, backoffMs: 1000 },
)

const statsQueue = createQueue<{ brawlhallaId: number }>(
  newRedis(),
  'refresh-stats',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-stats START: ${data.brawlhallaId}`)
    await processRefreshStats(deps, data.brawlhallaId)
    console.log(`[queue] refresh-stats DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  { concurrency: 2, retries: 3, backoffMs: 1000 },
)

const clanQueue = createQueue<{ clanId: number }>(
  newRedis(),
  'refresh-clan',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-clan START: ${data.clanId}`)
    await processRefreshClan(deps, data.clanId)
    console.log(`[queue] refresh-clan DONE: ${data.clanId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  { concurrency: 1, retries: 3, backoffMs: 1000 },
)

console.log('Worker starting...')
await initGameData(db, bhapi)
Promise.all([rankedQueue.start(), statsQueue.start(), clanQueue.start()]).catch(console.error)

const stopJanitor = startJanitor({ db, bhapi, redis: newRedis(), rankedQueue, statsQueue, clanQueue })

process.on('SIGINT', async () => {
  console.log('Worker shutting down...')
  rankedQueue.stop()
  statsQueue.stop()
  clanQueue.stop()
  await stopJanitor()
  console.log('Lock released. Goodbye.')
  process.exit(0)
})

console.log('Worker running. Queues: refresh-ranked(3), refresh-stats(2), refresh-clan(1). Janitor active.')
