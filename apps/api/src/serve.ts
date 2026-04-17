import { createClanRepo } from '@brawltome/clan'
import { db } from '@brawltome/database'
import {
  SESSION_TTL_MS,
  createPlayerLinkRepo,
  createSessionRepo,
  createUserRepo,
  getCurrentUser,
} from '@brawltome/identity'
import { DEDUP_TTL_RANKED_SEC, DEDUP_TTL_STATS_SEC, createPlayerRepo, getPlayer } from '@brawltome/player'
import { createRankingRepo } from '@brawltome/ranking'
import { TIERED_TTL, createMetricsRegistry, createQueue, dedupKey, getLegendById, initGameData, tryDedup } from '@brawltome/shared'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { SESSION_COOKIE, buildSessionCookie, parseCookies } from './auth/cookies'
import { createAuthRoutes } from './auth/routes'
import { appRouter } from './router'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const metrics = createMetricsRegistry(redis)

await initGameData(db)

// API only enqueues -- concurrency 0 means no consumer loop
const rankedQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  redis,
  'refresh-ranked',
  async () => {},
  { concurrency: 0, maxDepth: 2000, dedupKey: (d) => String(d.brawlhallaId), metrics },
)
const statsQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  redis,
  'refresh-stats',
  async () => {},
  { concurrency: 0, maxDepth: 2000, dedupKey: (d) => String(d.brawlhallaId), metrics },
)
const clanQueue = createQueue<{ clanId: number; caller: 'on-demand' | 'background' }>(
  redis,
  'refresh-clan',
  async () => {},
  { concurrency: 0, maxDepth: 1000, dedupKey: (d) => String(d.clanId), metrics },
)

const playerRepo = createPlayerRepo(db)
const clanRepo = createClanRepo(db)
const rankingRepo = createRankingRepo(db)
const userRepo = createUserRepo(db)
const sessionRepo = createSessionRepo(db)
const playerLinkRepo = createPlayerLinkRepo(db)
const steamLinkQueue = createQueue<{ userId: string; steamId: string; caller: 'background' }>(
  redis,
  'resolve-steam',
  async () => {},
  {
    concurrency: 0,
    maxDepth: 500,
    dedupKey: (d) => `${d.userId}:${d.steamId}`,
    metrics,
  },
)

const sharedCtx = {
  db,
  redis,
  rankedQueue,
  statsQueue,
  clanQueue,
  playerRepo,
  clanRepo,
  rankingRepo,
  userRepo,
  sessionRepo,
  playerLinkRepo,
  steamLinkQueue,
}

const app = new Hono()

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

const authConfig = {
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3000/auth/discord/callback',
  webOrigin: process.env.WEB_ORIGIN ?? corsOrigins[0] ?? 'http://localhost:3001',
  steamReturnUrl: process.env.STEAM_RETURN_URL ?? 'http://localhost:3000/auth/steam/callback',
  steamRealm: process.env.STEAM_REALM ?? 'http://localhost:3000',
}

app.use(
  '/*',
  cors({
    origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
    credentials: true,
  }),
)

app.route('/auth', createAuthRoutes({ userRepo, sessionRepo, playerLinkRepo, steamLinkQueue, config: authConfig }))

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c) => {
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

      const cookies = parseCookies(c.req.header('cookie'))
      const rawToken = cookies[SESSION_COOKIE] ?? null
      const current = await getCurrentUser({ userRepo, sessionRepo }, rawToken)

      if (current?.extended && rawToken) {
        c.header('Set-Cookie', buildSessionCookie(rawToken, SESSION_TTL_MS / 1000), { append: true })
      }

      return {
        ...sharedCtx,
        clientIp,
        isBot,
        internalSecret,
        user: current?.user ?? null,
        session: current?.session ?? null,
      } as unknown as Record<string, unknown>
    },
  }),
)

app.get('/health', (c) => c.json({ status: 'healthy' }))

app.get('/internal/metrics', async (c) => {
  const secret = c.req.header('x-internal-secret')
  if (!process.env.INTERNAL_API_SECRET || secret !== process.env.INTERNAL_API_SECRET) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const queues = await metrics.snapshotAllQueues()
  const tokensOnDemand = await metrics.getScalar('bhapi:tokens_on_demand_remaining')
  const tokensBackground = await metrics.getScalar('bhapi:tokens_background_remaining')
  const pausedUntilMs = await metrics.getScalar('bhapi:paused_until_ms')

  return c.json({
    queues,
    bhapi: {
      tokens_on_demand_remaining: tokensOnDemand,
      tokens_background_remaining: tokensBackground,
      paused_until_ms: pausedUntilMs,
    },
  })
})

app.get('/api/overlay/opponent/:bhid', async (c) => {
  const bhid = Number(c.req.param('bhid'))
  if (!Number.isInteger(bhid) || bhid <= 0) {
    return c.json({ error: 'Invalid bhid' }, 400)
  }

  const p = await getPlayer(playerRepo, bhid)
  if (!p) {
    await playerRepo.createPlaceholder(bhid)

    await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid, caller: 'on-demand' }, true)
    await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid, caller: 'on-demand' }, true)
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
    if (canDedup) await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid, caller: 'background' }, true)
  }

  const statsStale = !p.statsLastUpdated || now - p.statsLastUpdated.getTime() > ttl.stats
  if (statsStale) {
    const canDedup = await tryDedup(redis, dedupKey('stats', bhid), DEDUP_TTL_STATS_SEC)
    if (canDedup) await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid, caller: 'background' }, true)
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
