import { createClanRepo } from '@brawltome/clan'
import { db } from '@brawltome/database'
import { DEDUP_TTL_RANKED_SEC, DEDUP_TTL_STATS_SEC, createPlayerRepo, getPlayer } from '@brawltome/player'
import { createRankingRepo } from '@brawltome/ranking'
import { TIERED_TTL, createQueue, dedupKey, getLegendById, initGameData, tryDedup } from '@brawltome/shared'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { appRouter } from './router'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

await initGameData(db)

// API only enqueues -- concurrency 0 means no consumer loop
const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async () => {}, { concurrency: 0 })
const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async () => {}, { concurrency: 0 })
const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async () => {}, { concurrency: 0 })

const playerRepo = createPlayerRepo(db)
const clanRepo = createClanRepo(db)
const rankingRepo = createRankingRepo(db)

const sharedCtx = { db, redis, rankedQueue, statsQueue, clanQueue, playerRepo, clanRepo, rankingRepo }

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
      return { ...sharedCtx, clientIp, isBot, internalSecret } as unknown as Record<string, unknown>
    },
  }),
)

app.get('/health', (c) => c.json({ status: 'healthy' }))

app.get('/api/overlay/opponent/:bhid', async (c) => {
  const bhid = Number(c.req.param('bhid'))
  if (!Number.isInteger(bhid) || bhid <= 0) {
    return c.json({ error: 'Invalid bhid' }, 400)
  }

  const p = await getPlayer(playerRepo, bhid)
  if (!p) {
    await playerRepo.createPlaceholder(bhid)

    await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid }, true)
    await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid }, true)
    console.log(`[overlay] discovering player ${bhid}`)

    return c.json({
      brawlhallaId: bhid,
      name: `Player ${bhid}`,
      rating: 0,
      peakRating: 0,
      playtime: 0,
      tier: 'Unranked',
      region: '',
      legendKey: '',
      winRate: 0,
    })
  }

  const now = Date.now()
  const ttl = TIERED_TTL.hot

  const rankedStale = !p.rankedLastUpdated || now - p.rankedLastUpdated.getTime() > ttl.ranked
  if (rankedStale) {
    const canDedup = await tryDedup(redis, dedupKey('ranked', bhid), DEDUP_TTL_RANKED_SEC)
    if (canDedup) await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid }, true)
  }

  const statsStale = !p.statsLastUpdated || now - p.statsLastUpdated.getTime() > ttl.stats
  if (statsStale) {
    const canDedup = await tryDedup(redis, dedupKey('stats', bhid), DEDUP_TTL_STATS_SEC)
    if (canDedup) await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid }, true)
  }

  const legendKey = p.bestLegend ? (getLegendById(p.bestLegend)?.legendNameKey ?? '') : ''

  const winRate = p.rankedGames > 0 ? Math.round((p.rankedWins / p.rankedGames) * 1000) / 10 : 0

  const playtime = p.matchTimeTotal ? Math.round((p.matchTimeTotal / 3600) * 10) / 10 : 0

  return c.json({
    brawlhallaId: p.brawlhallaId,
    name: p.name,
    rating: p.rating,
    peakRating: p.peakRating ?? 0,
    playtime,
    tier: p.tier ?? 'Unranked',
    region: p.region ?? '',
    legendKey,
    winRate,
  })
})

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

export default {
  port,
  fetch: app.fetch,
}

console.log(`API server running on port ${port}`)
