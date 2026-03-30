import { db } from '@brawltome/database'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { createQueue } from './queue/queue'
import { appRouter } from './router'
import { initGameData } from './services/game-data.service'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

await initGameData(db)

// API only enqueues — concurrency 0 means no consumer loop
const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async () => {}, { concurrency: 0 })
const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async () => {}, { concurrency: 0 })
const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async () => {}, { concurrency: 0 })

const sharedCtx = { db, redis, rankedQueue, statsQueue, clanQueue }

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
      const ua = c.req.header('x-original-ua') ?? c.req.header('user-agent') ?? ''
      const isBot =
        /bot|crawl|spider|slurp|facebookexternalhit|meta-webindexer|bingpreview|yandex|baidu|duckduckbot|twitterbot|linkedinbot|embedly|quora|pinterest|redditbot|applebot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider/i.test(
          ua,
        )
      const internalSecret = c.req.header('x-internal-secret') ?? undefined
      const turnstileToken = c.req.header('x-turnstile-token') ?? undefined
      return { ...sharedCtx, clientIp, isBot, internalSecret, turnstileToken } as unknown as Record<string, unknown>
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
