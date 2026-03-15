import { BhApiClient } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { appRouter } from './router'
import { initGameData } from './services/game-data.service'

const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) {
  throw new Error('BRAWLHALLA_API_KEY environment variable is required')
}

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const bhapi = new BhApiClient({ apiKey })

await initGameData(db, bhapi)

// API only enqueues — concurrency 0 means no consumer loop
const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async () => {}, { concurrency: 0 })
const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async () => {}, { concurrency: 0 })
const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async () => {}, { concurrency: 0 })

const sharedCtx = { db, bhapi, redis, rankedQueue, statsQueue, clanQueue }

const app = new Hono()

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

app.use(
  '/*',
  cors({
    origin: corsOrigins,
  }),
)

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) => {
      const clientIp =
        c.req.header('x-client-ip') ??
        c.req.header('cf-connecting-ip') ??
        c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
        '0.0.0.0'
      return { ...sharedCtx, clientIp } as unknown as Record<string, unknown>
    },
  }),
)

app.get('/health', (c) => c.json({ status: 'healthy' }))

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

export default {
  port,
  fetch: app.fetch,
}

console.log(`API server running on port ${port}`)
