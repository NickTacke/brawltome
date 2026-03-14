import { BhApiClient } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { initGameData } from './services/game-data.service'
import { startJanitor } from './services/janitor.service'
import { processRefreshClan, processRefreshRanked, processRefreshStats } from './services/refresh.service'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
// Each blocking consumer needs its own connection to avoid XREADGROUP serialization
const newRedis = () => new Redis(redisUrl)
const bhapi = new BhApiClient({ apiKey: process.env.BRAWLHALLA_API_KEY ?? '' })
const deps = { db, bhapi }

const rankedQueue = createQueue<{ brawlhallaId: number }>(
  newRedis(),
  'refresh-ranked',
  async (data) => {
    console.log(`[queue] refresh-ranked: ${data.brawlhallaId}`)
    await processRefreshRanked(deps, data.brawlhallaId)
  },
  { concurrency: 5, retries: 3, backoffMs: 1000 },
)

const statsQueue = createQueue<{ brawlhallaId: number }>(
  newRedis(),
  'refresh-stats',
  async (data) => {
    console.log(`[queue] refresh-stats: ${data.brawlhallaId}`)
    await processRefreshStats(deps, data.brawlhallaId)
  },
  { concurrency: 3, retries: 3, backoffMs: 1000 },
)

const clanQueue = createQueue<{ clanId: number }>(
  newRedis(),
  'refresh-clan',
  async (data) => {
    console.log(`[queue] refresh-clan: ${data.clanId}`)
    await processRefreshClan(deps, data.clanId)
  },
  { concurrency: 2, retries: 3, backoffMs: 1000 },
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

console.log('Worker running. Queues: refresh-ranked(5), refresh-stats(3), refresh-clan(2). Janitor active.')
