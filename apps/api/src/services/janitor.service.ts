import type { BhApiClient, Region } from '@brawltome/bhapi'
import { clan, clanMember, player, playerAlias } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import type { Queue } from '../queue/queue'
import { JANITOR_MIN_TOKENS } from './constants'

const REGIONS: Region[] = ['us-e', 'eu', 'sea', 'brz', 'aus', 'us-w', 'jpn', 'me', 'sa']
const HOT_PAGES = 10
const MAX_COLD_PAGE = 200
const COLD_TICK_INTERVAL = 10
const CLAN_BACKFILL_LIMIT = 2
const CLAN_BACKFILL_MAX_QUEUE = 50
const LOCK_KEY = 'janitor:lock'
const LOCK_TTL_SEC = 300
const HEARTBEAT_INTERVAL_MS = 30_000

// Lua script: only renew lock if we still own it
const RENEW_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`

// Lua script: only release lock if we still own it
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

interface JanitorDeps {
  db: Database
  bhapi: BhApiClient
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number }>
  statsQueue: Queue<{ brawlhallaId: number }>
  clanQueue: Queue<{ clanId: number }>
}

export function startJanitor(deps: JanitorDeps) {
  let tick = 0
  let lockValue = ''
  let heartbeatTimer: Timer | null = null

  const interval = setInterval(async () => {
    const acquired = await acquireLock(deps.redis)
    if (!acquired) return

    lockValue = acquired
    heartbeatTimer = setInterval(() => renewLock(deps.redis, lockValue), HEARTBEAT_INTERVAL_MS)
    tick++

    try {
      if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) {
        console.log(`[janitor] skipping tick ${tick}: only ${deps.bhapi.remainingTokens} tokens remaining`)
        return
      }

      // Hot pages every tick
      await syncRankingPages(deps, '1v1', 'all', 1, HOT_PAGES, 'cursor:hot:1v1')
      await syncRankingPages(deps, '2v2', 'all', 1, HOT_PAGES, 'cursor:hot:2v2')

      // Cold pages every N ticks
      if (tick % COLD_TICK_INTERVAL === 0) {
        await syncRankingPages(deps, '1v1', 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:1v1')
        await syncRankingPages(deps, '2v2', 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:2v2')
      }

      // Regional: rotate 1 region per tick
      const regionIndex = (tick - 1) % REGIONS.length
      const region = REGIONS[regionIndex]
      await syncRankingPages(deps, '1v1', region, 1, MAX_COLD_PAGE, `cursor:region:1v1:${region}`)
      await syncRankingPages(deps, '2v2', region, 1, MAX_COLD_PAGE, `cursor:region:2v2:${region}`)

      // Clan backfill
      await backfillClans(deps)

      // Valhallan confirmation
      await confirmValhallans(deps)

      console.log(`[janitor] tick ${tick} complete, ${deps.bhapi.remainingTokens} tokens remaining`)
    } catch (err) {
      console.error(`[janitor] tick ${tick} error:`, err)
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      await releaseLock(deps.redis, lockValue)
    }
  }, 60_000)

  return () => {
    clearInterval(interval)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }
}

// ---- LOCK MANAGEMENT ----

async function acquireLock(redis: Redis): Promise<string | null> {
  const value = crypto.randomUUID()
  const result = await redis.set(LOCK_KEY, value, 'EX', LOCK_TTL_SEC, 'NX')
  return result === 'OK' ? value : null
}

async function renewLock(redis: Redis, value: string) {
  const result = await redis.call('EVAL', RENEW_LOCK_SCRIPT, '1', LOCK_KEY, value, String(LOCK_TTL_SEC))
  if (result === 0) {
    console.warn('[janitor] lock lost during heartbeat')
  }
}

async function releaseLock(redis: Redis, value: string) {
  await redis.call('EVAL', RELEASE_LOCK_SCRIPT, '1', LOCK_KEY, value)
}

// ---- RANKING SYNC ----

async function syncRankingPages(
  deps: JanitorDeps,
  bracket: '1v1' | '2v2',
  region: Region | 'all',
  startPage: number,
  maxPage: number,
  cursorKey: string,
) {
  const cursor = await deps.redis.get(cursorKey)
  const page = cursor ? Math.max(startPage, Math.min(Number.parseInt(cursor, 10), maxPage)) : startPage

  if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) return

  const rankings = await deps.bhapi.getRankings(bracket, region as Region, page)

  if (rankings.length === 0) {
    await deps.redis.set(cursorKey, String(startPage))
    return
  }

  await savePlayers(deps, rankings)

  const nextPage = page + 1 > maxPage ? startPage : page + 1
  await deps.redis.set(cursorKey, String(nextPage))
}

async function savePlayers(
  deps: JanitorDeps,
  rankings: Array<{
    brawlhalla_id: number
    name: string
    rating: number
    peak_rating: number
    tier: string
    games: number
    wins: number
    region: string
    best_legend: number
    best_legend_games: number
    best_legend_wins: number
  }>,
) {
  for (const r of rankings) {
    const existing = await deps.db.query.player.findFirst({
      where: eq(player.brawlhallaId, r.brawlhalla_id),
      columns: { name: true, tier: true },
    })

    if (existing && existing.name !== r.name) {
      await deps.db
        .insert(playerAlias)
        .values({
          brawlhallaId: r.brawlhalla_id,
          key: existing.name.toLowerCase(),
          value: existing.name,
        })
        .onConflictDoNothing()
    }

    const isValhallan = r.tier === 'Valhallan'
    const now = new Date()

    const shared = {
      name: r.name,
      region: r.region,
      rating: r.rating,
      peakRating: r.peak_rating,
      tier: r.tier,
      rankedGames: r.games,
      rankedWins: r.wins,
      bestLegend: r.best_legend,
      bestLegendGames: r.best_legend_games,
      bestLegendWins: r.best_legend_wins,
    }

    await deps.db
      .insert(player)
      .values({
        brawlhallaId: r.brawlhalla_id,
        ...shared,
        ...(isValhallan ? { valhallanConfirmedAt: now } : {}),
      })
      .onConflictDoUpdate({
        target: player.brawlhallaId,
        set: {
          ...shared,
          lastUpdated: now,
          ...(isValhallan ? { valhallanConfirmedAt: now } : {}),
        },
      })
  }
}

// ---- CLAN BACKFILL ----

async function backfillClans(deps: JanitorDeps) {
  const queueDepth = await deps.statsQueue.depth()
  if (queueDepth > CLAN_BACKFILL_MAX_QUEUE) return

  const recentClans = await deps.db.query.clan.findMany({
    orderBy: [desc(clan.lastUpdated)],
    limit: 20,
    with: { members: true },
  })

  let enqueued = 0
  for (const c of recentClans) {
    if (enqueued >= CLAN_BACKFILL_LIMIT) break

    for (const member of c.members) {
      if (enqueued >= CLAN_BACKFILL_LIMIT) break

      const p = await deps.db.query.player.findFirst({
        where: eq(player.brawlhallaId, member.brawlhallaId),
        columns: { statsLastUpdated: true },
      })

      if (!p || !p.statsLastUpdated) {
        await deps.statsQueue.enqueue({ brawlhallaId: member.brawlhallaId })
        enqueued++
      }
    }
  }
}

// ---- VALHALLAN CONFIRMATION ----

async function confirmValhallans(deps: JanitorDeps) {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

  const valhallans = await deps.db
    .select({ brawlhallaId: player.brawlhallaId })
    .from(player)
    .where(
      sql`${player.tier} = 'Valhallan' AND (${player.valhallanConfirmedAt} IS NULL OR ${player.valhallanConfirmedAt} < ${twoDaysAgo})`,
    )
    .limit(5)

  for (const v of valhallans) {
    if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) break
    await deps.rankedQueue.enqueue({ brawlhallaId: v.brawlhallaId })
  }
}
