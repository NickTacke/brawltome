import { accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import { createClanRepo } from '@brawltome/clan'
import { closeDatabase, db } from '@brawltome/database'
import { createPlayerLinkRepo } from '@brawltome/identity/composition'
import { createMatchRepo } from '@brawltome/matchmaking'
import { createPlayerRepo, playerMigrationInventory } from '@brawltome/player/composition'
import { getV2PlayerProfile } from '@brawltome/player/v2-compatibility'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import {
  TIERED_TTL,
  checkRateLimit,
  createMetricsRegistry,
  createQueue,
  createR2Client,
  getLegendById,
  initGameData,
  verifyTurnstileResult,
} from '@brawltome/shared'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Redis from 'ioredis'
import { createDatabasePlayerReferenceQueries } from './adapters/player-reference.database'
import { SESSION_COOKIE, SESSION_COOKIE_TTL_SEC, buildSessionCookie, parseCookies } from './auth/cookies'
import { internalSecretValid } from './auth/internal-secret'
import {
  REFRESH_TRUST_COOKIE,
  buildRefreshTrustCookie,
  issueRefreshTrust,
  verifyRefreshTrust,
} from './auth/refresh-trust-cookie'
import { createAuthRoutes } from './auth/routes'
import { createHealthRoutes } from './health-routes'
import { readMatchmakingConfig } from './matchmaking-config'
import { createPostgresReadiness } from './postgres-readiness'
import { appRouter } from './router'
import { createContractProofRoutes } from './routes/contract-proof.routes'
import { createMatchmakingRoutes } from './routes/matchmaking.routes'
import { createRefreshOperationRoutes } from './routes/refresh-operations.routes'
import { readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'

if (!process.env.INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET.length < 32) {
  throw new Error('INTERNAL_API_SECRET must be set and at least 32 characters')
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const refreshTrustSecret = process.env.REFRESH_TRUST_COOKIE_SECRET
if (!refreshTrustSecret || Buffer.byteLength(refreshTrustSecret) < 32) {
  throw new Error('REFRESH_TRUST_COOKIE_SECRET must be set and at least 32 bytes')
}
const authenticatedRefreshIpLimit = Number(process.env.AUTHENTICATED_REFRESH_IP_LIMIT ?? 120)
if (!Number.isInteger(authenticatedRefreshIpLimit) || authenticatedRefreshIpLimit < 1) {
  throw new Error('AUTHENTICATED_REFRESH_IP_LIMIT must be a positive integer')
}

const accountsRuntime = createPostgresAccounts(databaseUrl)
const { accounts } = accountsRuntime
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
const metrics = createMetricsRegistry(redis)

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
const playerReferenceQueries = createDatabasePlayerReferenceQueries(db)
const refreshOperations = createPostgresRefreshOperations(databaseUrl)
const requestAdmission = createPostgresRequestAdmission(databaseUrl, {
  authenticatedIpLimit: authenticatedRefreshIpLimit,
  sourceLimits: { 'brawlhalla-v0': 180 },
})
const clanRepo = createClanRepo(db)
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

const matchmakingConfig = readMatchmakingConfig()
const r2 = createR2Client(matchmakingConfig.r2)
const matchmakingLive = matchmakingConfig.enabled && !!r2
const matchRepo = matchmakingLive ? createMatchRepo(db) : null
const postgresReadiness = createPostgresReadiness(databaseUrl, [
  ...playerMigrationInventory,
  ...refreshOperationsMigrationInventory,
  ...requestAdmissionMigrationInventory,
  ...accountsMigrationInventory,
])
let gameDataReady = false
const server = { current: undefined as ReturnType<typeof Bun.serve> | undefined }
const lifecycle = createRuntimeLifecycle({
  ...readRuntimeConfig(process.env),
  readinessProbes: [
    { name: 'postgres-schema', check: postgresReadiness.check },
    {
      name: 'game-data',
      check: async () => {
        if (!gameDataReady) throw new Error('game data is not initialized')
      },
    },
  ],
  stopAdmission: () => {
    void server.current?.stop(false)
  },
  closers: [
    {
      name: 'api-server',
      close: async () => {
        await server.current?.stop(true)
      },
    },
    { name: 'operations-postgres', close: refreshOperations.close },
    { name: 'request-admission-postgres', close: requestAdmission.close },
    { name: 'accounts-postgres', close: accountsRuntime.close },
    { name: 'database-postgres', close: closeDatabase },
    {
      name: 'redis',
      close: async () => {
        await redis.quit()
      },
    },
    { name: 'readiness-postgres', close: postgresReadiness.close },
  ],
})

console.log(
  `[api] matchmaking: ${matchmakingLive ? 'ENABLED' : 'disabled'}${
    matchmakingConfig.enabled && !r2 ? ' (R2 not configured)' : ''
  }`,
)

const sharedCtx = {
  db,
  redis,
  metrics,
  rankedQueue,
  statsQueue,
  clanQueue,
  playerRepo,
  playerReferenceQueries,
  refreshOperations,
  requestAdmission,
  verifyRefreshChallenge: verifyTurnstileResult,
  clanRepo,
  accounts,
  playerLinkRepo,
  steamLinkQueue,
  matchRepo,
  r2,
  matchmakingEnabled: matchmakingLive,
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

app.route('/auth', createAuthRoutes({ accounts, playerLinkRepo, steamLinkQueue, config: authConfig }))
app.route('/internal/contracts', createContractProofRoutes())
app.route('/internal/operations', createRefreshOperationRoutes(refreshOperations, process.env.INTERNAL_API_SECRET))

app.route(
  '/api/matches',
  createMatchmakingRoutes({
    matchRepo,
    r2,
    redis,
    metrics,
    accounts,
    enabled: matchmakingLive,
  }),
)

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
      const authentication = await accounts.authenticate(rawToken)
      const refreshTrustToken = cookies[REFRESH_TRUST_COOKIE]
      const refreshTrusted = verifyRefreshTrust(refreshTrustToken, refreshTrustSecret)

      if (authentication.status === 'signedIn' && authentication.extended && rawToken) {
        c.header('Set-Cookie', buildSessionCookie(rawToken, SESSION_COOKIE_TTL_SEC), { append: true })
      }

      return {
        ...sharedCtx,
        clientIp,
        isBot,
        internalSecret,
        account: authentication.status === 'signedIn' ? authentication.account : null,
        refreshTrust: {
          trusted: refreshTrusted,
          grant: () => {
            if (!refreshTrusted && authentication.status !== 'signedIn') {
              c.header('Set-Cookie', buildRefreshTrustCookie(issueRefreshTrust(refreshTrustSecret)), { append: true })
            }
          },
        },
      } as unknown as Record<string, unknown>
    },
  }),
)

app.route('/health', createHealthRoutes(lifecycle))

app.get('/internal/metrics', async (c) => {
  const secret = c.req.header('x-internal-secret')
  if (!internalSecretValid(secret, process.env.INTERNAL_API_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const queues = await metrics.snapshotAllQueues()
  const tokensOnDemand = await metrics.getScalar('bhapi:tokens_on_demand_remaining')
  const tokensBackground = await metrics.getScalar('bhapi:tokens_background_remaining')
  const pausedUntilMs = await metrics.getScalar('bhapi:paused_until_ms')
  const counters = await metrics.snapshotCounters()

  return c.json({
    queues,
    counters,
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

  const clientIp =
    c.req.header('x-client-ip') ??
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    '0.0.0.0'

  const rateLimit = await checkRateLimit(redis, clientIp, 'overlay', metrics)

  const p = await getV2PlayerProfile(playerRepo, bhid)
  if (!p) {
    await playerRepo.createPlaceholder(bhid)

    if (rateLimit.allowed) {
      await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid, caller: 'on-demand' }, true)
      await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid, caller: 'on-demand' }, true)
      console.log(`[overlay] discovering player ${bhid}`)
    } else {
      console.log(`[overlay] rate-limited for ${clientIp}, returning placeholder only`)
    }

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

  if (rateLimit.allowed) {
    const rankedStale = !p.rankedLastUpdated || now - p.rankedLastUpdated.getTime() > ttl.ranked
    if (rankedStale) {
      await sharedCtx.rankedQueue.enqueue({ brawlhallaId: bhid, caller: 'background' }, true)
    }

    const statsStale = !p.statsLastUpdated || now - p.statsLastUpdated.getTime() > ttl.stats
    if (statsStale) {
      await sharedCtx.statsQueue.enqueue({ brawlhallaId: bhid, caller: 'background' }, true)
    }
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
server.current = Bun.serve({
  port,
  fetch: async (request) => {
    const pathname = new URL(request.url).pathname
    if (pathname.startsWith('/health/')) return app.fetch(request)

    const finishWork = lifecycle.startWork()
    if (!finishWork) {
      return Response.json({ error: 'service_unavailable' }, { status: 503, headers: { 'retry-after': '1' } })
    }
    try {
      return await app.fetch(request)
    } finally {
      finishWork()
    }
  },
})
lifecycle.markReady()

async function initializeGameData(): Promise<void> {
  while (!lifecycle.signal.aborted && !gameDataReady) {
    const finishWork = lifecycle.startWork()
    if (!finishWork) return
    try {
      await initGameData(db)
      gameDataReady = true
    } catch (error) {
      console.error('[api] game data initialization failed; runtime remains unready', error)
    } finally {
      finishWork()
    }
    if (!gameDataReady) await Bun.sleep(1_000)
  }
}
void initializeGameData()

let shutdownRequested = false
function requestShutdown(): void {
  if (shutdownRequested) return
  shutdownRequested = true
  lifecycle.beginShutdown()
  void lifecycle.shutdown().then(({ drained, cleanupCompleted, errors }) => {
    if (!drained || !cleanupCompleted) process.exit(1)
    if (errors.length > 0) process.exitCode = 1
  })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, requestShutdown)

console.log(`API server running on port ${port}`)
