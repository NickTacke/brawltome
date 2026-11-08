import { createPostgresAccounts } from '@brawltome/accounts'
import { brawlhallaV0RequestLimit } from '@brawltome/bhapi'
import { createPostgresClans } from '@brawltome/clan'
import { createPostgresDiscovery } from '@brawltome/discovery'
import { checkModuleList, type Migration, type ModuleRuntime } from '@brawltome/foundation'
import {
  createPostgresCareerPlayers,
  createPostgresLeaderboardRanked,
  createPostgresPlayerReferences,
  createPostgresProfileViews,
  createPostgresRankedPlayers,
} from '@brawltome/player'
import { createPostgresRanking } from '@brawltome/ranking'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations'
import { createPostgresReplayAnalysisJobs } from '@brawltome/replay-analysis'
import { createPostgresRequestAdmission } from '@brawltome/request-admission'
import { createPostgresStatistics } from '@brawltome/statistics'
import { instrumentHttpHandler, observeSourceCall, renderPrometheus } from '@brawltome/telemetry'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { buildSessionCookie, parseCookies, SESSION_COOKIE, SESSION_COOKIE_TTL_SEC } from './auth/cookies'
import { internalSecretValid } from './auth/internal-secret'
import {
  buildRefreshTrustCookie,
  issueRefreshTrust,
  REFRESH_TRUST_COOKIE,
  verifyRefreshTrust,
} from './auth/refresh-trust-cookie'
import { createAuthRoutes } from './auth/routes'
import { verifyTurnstileResult } from './auth/turnstile'
import { readClientIp, requestWithVerifiedClientIp } from './client-ip'
import { createApiDatabase } from './database-pools'
import { createHealthRoutes } from './health-routes'
import { apiModules } from './modules'
import { createOrpcRoutes } from './orpc/mount'
import { createOrpcRouter } from './orpc/router'
import { createPostgresReadiness } from './postgres-readiness'
import { createRefreshEventStreams } from './refresh-event-streams'
import { appRouter } from './router'
import { createDesktopRankedRoutes } from './routes/desktop-ranked.routes'
import { createRefreshEventRoutes } from './routes/refresh-events.routes'
import { createRefreshOperationRoutes } from './routes/refresh-operations.routes'
import { createReplayAnalysisRoutes, createReplayBridgeRoutes } from './routes/replay-analysis.routes'
import { readAuthenticatedRefreshIpLimit, readPort, readRuntimeConfig, readShutdownAnnounceMs } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
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

const replayBridgeSecret = process.env.REPLAY_BRIDGE_SECRET

if (!replayBridgeSecret || Buffer.byteLength(replayBridgeSecret) < 32) {
  throw new Error('REPLAY_BRIDGE_SECRET must be set and at least 32 bytes')
}

const authenticatedRefreshIpLimit = readAuthenticatedRefreshIpLimit(process.env.AUTHENTICATED_REFRESH_IP_LIMIT)

checkModuleList(apiModules)

const telemetry = createRuntimeTelemetry('api')
const runtimeConfig = readRuntimeConfig(process.env)
const shutdownAnnounceMs = readShutdownAnnounceMs(process.env.RUNTIME_SHUTDOWN_ANNOUNCE_MS)
// one client for every module: see database-pools.ts for how its size fits the Postgres connection budget
const database = createApiDatabase(databaseUrl)
const accountsRuntime = createPostgresAccounts(database)
const { accounts } = accountsRuntime
const careerPlayerQueries = createPostgresCareerPlayers(database)

const rankedPlayerQueries = createPostgresRankedPlayers(database, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayerQueries.mainLegendById(brawlhallaId),
})

const profileViews = createPostgresProfileViews(database)
const leaderboardStandings = createPostgresLeaderboardRanked(database)
const discovery = createPostgresDiscovery(database)

const playerReferenceQueries = createPostgresPlayerReferences(database)

const refreshOperations = createPostgresRefreshOperations({ database })
const refreshEvents = createRefreshEventStreams({ source: refreshOperations, telemetry })

const requestAdmission = createPostgresRequestAdmission(database, {
  authenticatedIpLimit: authenticatedRefreshIpLimit,
  sourceLimits: { 'brawlhalla-v0': brawlhallaV0RequestLimit },
})

const ranking = createPostgresRanking(database)
const statistics = createPostgresStatistics(database)
const replayAnalysisJobs = createPostgresReplayAnalysisJobs(database)
const clanRepo = createPostgresClans(database)
const moduleRuntime: ModuleRuntime = { database }
const orpcRouter = createOrpcRouter(apiModules, moduleRuntime)

const postgresReadiness = createPostgresReadiness(
  database.sql,
  apiModules.flatMap((module): readonly Migration[] => module.migrations),
)

const server = { current: undefined as ReturnType<typeof Bun.serve> | undefined }

const lifecycle = createRuntimeLifecycle({
  ...runtimeConfig,
  readinessProbes: [{ name: 'postgres-schema', check: postgresReadiness.check }],
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
    { name: 'refresh-events', close: refreshEvents.close },
    // after the server and the event streams: nothing uses the database once they have stopped
    { name: 'database', close: database.close },
    { name: 'telemetry', close: () => telemetry.shutdown(runtimeConfig.cleanupReserveMs) },
  ],
})

const sharedCtx = {
  telemetry,
  database,
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
  profileViews,
  leaderboardStandings,
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
    allowHeaders: ['Content-Type', 'Traceparent', 'X-Replay-File-Name', 'X-Request-Id'],
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

app.route('/events', createRefreshEventRoutes(refreshEvents))
app.route('/api', createReplayAnalysisRoutes({ accounts, jobs: replayAnalysisJobs, webOrigin: authConfig.webOrigin }))
app.route('/internal/replays', createReplayBridgeRoutes({ jobs: replayAnalysisJobs, secret: replayBridgeSecret }))

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c) => {
      const clientIp = readClientIp(c.req.raw.headers)
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

// oRPC is served next to tRPC while the modules move over one by one: /rpc/*, /v1/* and /openapi.json
app.route('/', createOrpcRoutes({ telemetry, internalSecret: process.env.INTERNAL_API_SECRET, router: orpcRouter }))

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
      telemetry.metrics.set('operation_dead_letters', item.count, {
        work_class: item.workClass,
        kind: item.kind,
        reason: item.reason,
      })
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

const port = readPort('PORT', process.env.PORT, 3000)

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

    // Event streams outlive Bun's 10 s idle timeout between keep-alives; each stream bounds its own lifetime.
    if (pathname.startsWith('/events/')) server.current?.timeout(request, 0)

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

let shutdownRequested = false

function requestShutdown(): void {
  if (shutdownRequested) return

  shutdownRequested = true
  // Keep serving while /health/serving reports draining, so Traefik stops routing here before admission stops.
  lifecycle.announceShutdown()
  // End open event streams now: browsers reconnect after the stream's retry delay and land on the replacement once
  // Traefik's serving check drops this container; until then this process answers them with another retry hint.
  refreshEvents.drain()

  setTimeout(() => {
    lifecycle.beginShutdown()

    void lifecycle.shutdown().then(({ drained, cleanupCompleted, errors }) => {
      if (!drained || !cleanupCompleted) process.exit(1)

      if (errors.length > 0) process.exitCode = 1
    })
  }, shutdownAnnounceMs)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, requestShutdown)

telemetry.logger.info('api.started', { port })
