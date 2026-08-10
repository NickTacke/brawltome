import { createPostgresAccounts } from '@brawltome/accounts/composition'
import { createPostgresClans } from '@brawltome/clan/composition'
import { closeDatabase, db } from '@brawltome/database'
import { createPostgresDiscovery } from '@brawltome/discovery/composition'
import { createMatchRepo } from '@brawltome/matchmaking'
import {
  createPlayerRepo,
  createPostgresCareerPlayers,
  createPostgresRankedPlayers,
} from '@brawltome/player/composition'
import { createPostgresRanking } from '@brawltome/ranking/composition'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { createPostgresRequestAdmission } from '@brawltome/request-admission/composition'
import {
  createMetricsRegistry,
  createQueue,
  createR2Client,
  initGameData,
  verifyTurnstileResult,
} from '@brawltome/shared'
import { createPostgresStatistics } from '@brawltome/statistics/composition'
import { instrumentHttpHandler, observeSourceCall, renderPrometheus } from '@brawltome/telemetry'
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
import { requestWithVerifiedClientIp } from './client-ip'
import { createHealthRoutes } from './health-routes'
import { readMatchmakingConfig } from './matchmaking-config'
import { createPostgresReadiness } from './postgres-readiness'
import { appRouter } from './router'
import { createContractProofRoutes } from './routes/contract-proof.routes'
import { createDesktopRankedRoutes } from './routes/desktop-ranked.routes'
import { createMatchmakingRoutes } from './routes/matchmaking.routes'
import { createRefreshOperationRoutes } from './routes/refresh-operations.routes'
import { readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { runtimeMigrationInventory } from './runtime-migration-inventory'
import { createRuntimeTelemetry } from './telemetry'

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

const telemetry = createRuntimeTelemetry('api')
const runtimeConfig = readRuntimeConfig(process.env)
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
const playerRepo = createPlayerRepo(db)
const careerPlayerQueries = createPostgresCareerPlayers(databaseUrl)
const rankedPlayerQueries = createPostgresRankedPlayers(databaseUrl, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayerQueries.mainLegendById(brawlhallaId),
})
const discovery = createPostgresDiscovery(databaseUrl)
const playerReferenceQueries = createDatabasePlayerReferenceQueries(
  db,
  (brawlhallaId) => rankedPlayerQueries.referenceById(brawlhallaId),
  (brawlhallaId) => careerPlayerQueries.referenceById(brawlhallaId),
)
const refreshOperations = createPostgresRefreshOperations(databaseUrl)
const requestAdmission = createPostgresRequestAdmission(databaseUrl, {
  authenticatedIpLimit: authenticatedRefreshIpLimit,
  sourceLimits: { 'brawlhalla-v0': 180 },
})
const ranking = createPostgresRanking(databaseUrl)
const statistics = createPostgresStatistics(databaseUrl)
const clanRepo = createPostgresClans(databaseUrl)
const matchmakingConfig = readMatchmakingConfig()
const r2 = createR2Client(matchmakingConfig.r2)
const matchmakingLive = matchmakingConfig.enabled && !!r2
const matchRepo = matchmakingLive ? createMatchRepo(db) : null
const postgresReadiness = createPostgresReadiness(databaseUrl, runtimeMigrationInventory)
let gameDataReady = false
const server = { current: undefined as ReturnType<typeof Bun.serve> | undefined }

const lifecycle = createRuntimeLifecycle({
  ...runtimeConfig,
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
    { name: 'clans-postgres', close: clanRepo.close },
    { name: 'discovery-postgres', close: discovery.close },
    { name: 'players-ranked-postgres', close: rankedPlayerQueries.close },
    { name: 'players-career-postgres', close: careerPlayerQueries.close },
    { name: 'request-admission-postgres', close: requestAdmission.close },
    { name: 'accounts-postgres', close: accountsRuntime.close },
    { name: 'ranking-postgres', close: ranking.close },
    { name: 'statistics-postgres', close: statistics.close },
    { name: 'database-postgres', close: closeDatabase },
    {
      name: 'redis',
      close: async () => {
        await redis.quit()
      },
    },
    { name: 'readiness-postgres', close: postgresReadiness.close },
    { name: 'telemetry', close: () => telemetry.shutdown(runtimeConfig.cleanupReserveMs) },
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
  telemetry,
  rankedQueue,
  statsQueue,
  playerRepo,
  playerReferenceQueries,
  discoveryQueries: discovery,
  rankedPlayerQueries,
  careerPlayerQueries,
  refreshOperations,
  requestAdmission,
  verifyRefreshChallenge: (token: string, remoteIp: string) =>
    observeSourceCall(telemetry, 'turnstile', () => verifyTurnstileResult(token, remoteIp)),
  rankingQueries: ranking.queries,
  statisticsQueries: statistics,
  clanRepo,
  accounts,
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

app.route(
  '/auth',
  createAuthRoutes({
    accounts,
    requestAdmission,
    verificationOperations: refreshOperations,
    config: authConfig,
    observeSourceCall: (domain, work) => observeSourceCall(telemetry, domain, work),
    logger: telemetry.logger,
  }),
)
app.route('/internal/contracts', createContractProofRoutes())
app.route(
  '/api/overlay',
  createDesktopRankedRoutes({
    playerReferences: playerReferenceQueries,
    rankedPlayers: rankedPlayerQueries,
    refreshOperations,
    requestAdmission,
  }),
)
app.route(
  '/internal/operations',
  createRefreshOperationRoutes(refreshOperations, process.env.INTERNAL_API_SECRET, telemetry),
)

app.route(
  '/api/matches',
  createMatchmakingRoutes({
    matchRepo,
    r2,
    redis,
    metrics,
    accounts,
    enabled: matchmakingLive,
    observeSourceCall: (domain, work) => observeSourceCall(telemetry, domain, work),
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
      const discordInternalSecret = c.req.header('x-discord-internal-secret') ?? undefined

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
        discordInternalSecret,
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

app.get('/metrics', async (c) => {
  if (!internalSecretValid(c.req.header('x-metrics-secret'), process.env.METRICS_SCRAPE_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  try {
    const [operations, quota] = await Promise.all([
      refreshOperations.inspectTelemetry(),
      requestAdmission.inspectCurrentUsage(),
    ])
    for (const item of operations.oldestPending) {
      telemetry.metrics.set('operation_oldest_pending_age_ms', item.ageMs, { work_class: item.workClass })
    }
    for (const item of operations.deadLetters) {
      telemetry.metrics.set('operation_dead_letters', item.count, { work_class: item.workClass, kind: item.kind })
    }
    for (const item of operations.scheduleLateness) {
      telemetry.metrics.set('schedule_lateness_ms', item.latenessMs, { kind: item.kind })
    }
    for (const item of quota.domains) {
      telemetry.metrics.set('source_quota_used', item.used, { domain: item.domain })
      telemetry.metrics.set('source_quota_limit', item.limit, { domain: item.domain })
    }
  } catch (error) {
    telemetry.logger.error('metrics.measurement.failed', error)
  }
  return c.body(renderPrometheus(telemetry.metrics.snapshot()), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  })
})

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

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const instrumentedFetch = instrumentHttpHandler(
  telemetry,
  'api',
  async (request) => {
    const verifiedRequest = requestWithVerifiedClientIp(
      request,
      server.current?.requestIP(request)?.address ?? '0.0.0.0',
    )
    let pathname: string
    try {
      pathname = new URL(verifiedRequest.url).pathname
    } catch {
      return Response.json({ error: 'invalid_request_url' }, { status: 400 })
    }
    if (pathname.startsWith('/health/')) return app.fetch(verifiedRequest)

    const finishWork = lifecycle.startWork()
    if (!finishWork) {
      return Response.json({ error: 'service_unavailable' }, { status: 503, headers: { 'retry-after': '1' } })
    }
    try {
      return await app.fetch(verifiedRequest)
    } finally {
      finishWork()
    }
  },
  {
    acceptIncoming: (request) =>
      internalSecretValid(request.headers.get('x-internal-secret') ?? undefined, process.env.INTERNAL_API_SECRET),
  },
)
server.current = Bun.serve({ port, fetch: instrumentedFetch })
lifecycle.markReady()

async function initializeGameData(): Promise<void> {
  while (!lifecycle.signal.aborted && !gameDataReady) {
    const finishWork = lifecycle.startWork()
    if (!finishWork) return
    try {
      await initGameData(db)
      gameDataReady = true
    } catch (error) {
      telemetry.logger.error('api.game_data.initialization_failed', error)
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

telemetry.logger.info('api.started', { port })
