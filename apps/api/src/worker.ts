import { BhApiClient } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { startJanitor } from './services/janitor.service'
import { processRefreshClan, processRefreshRanked, processRefreshStats } from './services/refresh.service'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const bhapi = new BhApiClient({ apiKey: process.env.BRAWLHALLA_API_KEY ?? '' })
const deps = { db, bhapi }

const rankedQueue = createQueue<{ brawlhallaId: number }>(
  redis,
  'refresh-ranked',
  async (data) => {
    console.log(`[queue] refresh-ranked: ${data.brawlhallaId}`)
    await processRefreshRanked(deps, data.brawlhallaId)
  },
  { concurrency: 5, retries: 3, backoffMs: 1000 },
)

const statsQueue = createQueue<{ brawlhallaId: number }>(
  redis,
  'refresh-stats',
  async (data) => {
    console.log(`[queue] refresh-stats: ${data.brawlhallaId}`)
    await processRefreshStats(deps, data.brawlhallaId)
  },
  { concurrency: 3, retries: 3, backoffMs: 1000 },
)

const clanQueue = createQueue<{ clanId: number }>(
  redis,
  'refresh-clan',
  async (data) => {
    console.log(`[queue] refresh-clan: ${data.clanId}`)
    await processRefreshClan(deps, data.clanId)
  },
  { concurrency: 2, retries: 3, backoffMs: 1000 },
)

console.log('Worker starting...')
Promise.all([rankedQueue.start(), statsQueue.start(), clanQueue.start()]).catch(console.error)

const stopJanitor = startJanitor({ db, bhapi, redis, rankedQueue, statsQueue, clanQueue })

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
