import { randomUUID } from 'node:crypto'
import { BhApiClient, RateLimitError } from '@brawltome/bhapi'
import { db } from '@brawltome/database'
import { backfillPending, createMatchRepo } from '@brawltome/matchmaking'
import { createPlayerRepo, processRefreshRanked, processRefreshStats } from '@brawltome/player/composition'
import { startSweep } from '@brawltome/ranking'
import { type ParsedReplay, parse as parseReplay } from '@brawltome/replay-format'
import { createPostgresRequestAdmission } from '@brawltome/request-admission/composition'
import { createMetricsRegistry, createQueue, createR2Client, initGameData } from '@brawltome/shared'
import Redis from 'ioredis'
import { readMatchmakingConfig } from './matchmaking-config'
import { readBrawlhallaV1RequestLimit } from './operations-worker-config'

const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) {
  throw new Error('BRAWLHALLA_API_KEY environment variable is required')
}

if (!process.env.INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET.length < 32) {
  throw new Error('INTERNAL_API_SECRET must be set and at least 32 characters')
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const requestAdmission = createPostgresRequestAdmission(connectionString, {
  authenticatedIpLimit: Number(process.env.AUTHENTICATED_REFRESH_IP_LIMIT ?? 120),
  sourceLimits: {
    'brawlhalla-v0': 180,
    'brawlhalla-v1': readBrawlhallaV1RequestLimit(process.env.BRAWLHALLA_V1_REQUEST_LIMIT),
  },
})

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
// Each blocking consumer needs its own connection to avoid XREADGROUP serialization
const newRedis = () => new Redis(redisUrl)
const bhapiRedis = newRedis()
const metricsRedis = newRedis()
const metrics = createMetricsRegistry(metricsRedis)
const bhapi = new BhApiClient({
  apiKey,
  persistence: { redis: bhapiRedis, keyPrefix: 'bhapi' },
  metrics,
  beforeRequest: async ({ domain }) => {
    const result = await requestAdmission.admitSource({ domain, reservationKey: randomUUID(), units: 1 })
    if (result.outcome === 'rate-limited') {
      throw new RateLimitError(
        `${domain} PostgreSQL source admission is rate limited`,
        result.retryAfterSeconds * 1_000,
      )
    }
  },
})
const deps = { db, bhapi }

const rankedQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  newRedis(),
  'refresh-ranked',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-ranked START: ${data.brawlhallaId} (caller=${data.caller})`)
    await processRefreshRanked(deps, data.brawlhallaId, data.caller ?? 'background')
    console.log(`[queue] refresh-ranked DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 3,
    retries: 3,
    backoffMs: 1000,
    maxDepth: 2000,
    dedupKey: (d) => String(d.brawlhallaId),
    priorityRatio: 3,
    metrics,
  },
)

const statsQueue = createQueue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>(
  newRedis(),
  'refresh-stats',
  async (data) => {
    const start = performance.now()
    console.log(`[queue] refresh-stats START: ${data.brawlhallaId} (caller=${data.caller})`)
    await processRefreshStats(deps, data.brawlhallaId, data.caller ?? 'background')
    console.log(`[queue] refresh-stats DONE: ${data.brawlhallaId} (${(performance.now() - start).toFixed(0)}ms)`)
  },
  {
    concurrency: 2,
    retries: 3,
    backoffMs: 1000,
    maxDepth: 2000,
    dedupKey: (d) => String(d.brawlhallaId),
    priorityRatio: 3,
    metrics,
  },
)

export interface ActiveSimulator {
  version: number
  supportedFormatVersions: readonly number[]
  run(parsed: ParsedReplay, raw: Uint8Array): Promise<unknown>
}

// Function form stops TS narrowing to `never` once a simulator is wired up.
export function getActiveSimulator(): ActiveSimulator | null {
  return null
}

const matchmakingConfig = readMatchmakingConfig()
const r2 = createR2Client(matchmakingConfig.r2)
const matchmakingLive = matchmakingConfig.enabled && !!r2
const matchRepo = matchmakingLive ? createMatchRepo(db) : null

const simulateQueue =
  matchmakingLive && matchRepo && r2
    ? createQueue<{ matchSlug: string; formatVersion: number }>(
        newRedis(),
        'match-simulate',
        async (data) => {
          const sim = getActiveSimulator()
          if (!sim) return
          if (!sim.supportedFormatVersions.includes(data.formatVersion)) return
          console.log(`[queue] match-simulate ${data.matchSlug} (fmt=${data.formatVersion})`)
          const row = await matchRepo.findBySlug(data.matchSlug)
          if (!row) return
          const raw = await r2.get(row.replayStorageKey)
          const parsed = parseReplay(raw)
          const stats = await sim.run(parsed, raw)
          const statsKey = `stats/${row.slug}.json`
          await r2.put(statsKey, new TextEncoder().encode(JSON.stringify(stats)), {
            contentType: 'application/json',
          })
          await matchRepo.markParsed(row.slug, {
            detailedStatsKey: statsKey,
            simVersion: sim.version,
            simRanAt: new Date(),
          })
        },
        {
          concurrency: 1,
          retries: 2,
          backoffMs: 2000,
          maxDepth: 1000,
          dedupKey: (d) => d.matchSlug,
          metrics,
        },
      )
    : null

const backfillQueue =
  matchmakingLive && matchRepo && r2
    ? createQueue<{ matchSlug: string }>(
        newRedis(),
        'match-backfill-parse',
        async (data) => {
          const row = await matchRepo.findBySlug(data.matchSlug)
          if (!row || row.parseStatus !== 'pending') return
          console.log(`[queue] match-backfill-parse ${row.slug} (fmt=${row.formatVersion})`)
          await backfillPending(
            {
              matchRepo,
              r2Get: (k) => r2.get(k),
              parse: (raw) => parseReplay(raw),
            },
            row,
          )
          const sim = getActiveSimulator()
          if (simulateQueue && sim && row.formatVersion && sim.supportedFormatVersions.includes(row.formatVersion)) {
            await simulateQueue.enqueue({
              matchSlug: row.slug,
              formatVersion: row.formatVersion,
            })
          }
        },
        {
          concurrency: 1,
          retries: 2,
          backoffMs: 2000,
          maxDepth: 1000,
          dedupKey: (d) => d.matchSlug,
          metrics,
        },
      )
    : null

console.log(`[worker] matchmaking: ${matchmakingLive ? 'ENABLED' : 'disabled'}`)

let bhapiMetricsTimer: Timer | null = null
let bhapiMetricsStopped = false

async function snapBhapiMetrics() {
  try {
    await metrics.setScalar('bhapi:tokens_on_demand_remaining', bhapi.remainingTokens('on-demand'))
    await metrics.setScalar('bhapi:tokens_background_remaining', bhapi.remainingTokens('background'))
    await metrics.setScalar('bhapi:paused_until_ms', bhapi.pausedUntilMs)
  } catch (err) {
    console.error('[worker] bhapi metrics snapshot error:', err)
  } finally {
    if (!bhapiMetricsStopped) {
      bhapiMetricsTimer = setTimeout(snapBhapiMetrics, 5000)
    }
  }
}

bhapiMetricsTimer = setTimeout(snapBhapiMetrics, 5000)

console.log('Worker starting...')
await bhapi.init()
await initGameData(db, bhapi)
const starts: Promise<void>[] = [rankedQueue.start(), statsQueue.start()]
if (backfillQueue) starts.push(backfillQueue.start())
if (simulateQueue) starts.push(simulateQueue.start())
Promise.all(starts).catch((err) => {
  console.error('[worker] a queue consumer failed to start, exiting:', err)
  process.exit(1)
})

const playerRepo = createPlayerRepo(db)
const stopSweep =
  process.env.DISABLE_JANITOR === '1' ? async () => {} : startSweep({ redis: newRedis(), repo: playerRepo, metrics })

let shutdownStarted = false
async function shutdownWorker(): Promise<void> {
  if (shutdownStarted) return
  shutdownStarted = true
  console.log('Worker shutting down...')
  bhapiMetricsStopped = true
  if (bhapiMetricsTimer) clearTimeout(bhapiMetricsTimer)
  rankedQueue.stop()
  statsQueue.stop()
  backfillQueue?.stop()
  simulateQueue?.stop()
  await stopSweep()
  await metricsRedis.quit().catch(() => {})
  await bhapiRedis.quit().catch(() => {})
  await requestAdmission.close().catch(() => {})
  console.log('Lock released. Goodbye.')
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void shutdownWorker())

const matchmakingQueues = matchmakingLive ? ', match-backfill-parse(1), match-simulate(1)' : ''
console.log(`Worker running. Queues: refresh-ranked(3), refresh-stats(2)${matchmakingQueues}. Sweep active.`)
