import { BhApiClient } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { appRouter } from './router'
import { initGameData } from './services/game-data.service'
import type { Context } from './trpc/context'

if (!process.env.BRAWLHALLA_API_KEY) {
  throw new Error('BRAWLHALLA_API_KEY environment variable is required')
}

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const bhapi = new BhApiClient({ apiKey: process.env.BRAWLHALLA_API_KEY })

await initGameData(db, bhapi)

// API only enqueues — concurrency 0 means no consumer loop
const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async () => {}, { concurrency: 0 })
const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async () => {}, { concurrency: 0 })
const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async () => {}, { concurrency: 0 })

const ctx: Context = { db, bhapi, redis, rankedQueue, statsQueue, clanQueue }

const app = new Hono()

app.use(
  '/*',
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3001'],
  }),
)

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: () => ctx,
  }),
)

app.get('/health', (c) => c.json({ status: 'healthy' }))

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

export default {
  port,
  fetch: app.fetch,
}

console.log(`API server running on port ${port}`)
