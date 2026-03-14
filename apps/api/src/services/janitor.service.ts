import type { BhApiClient, BhApiRanking2v2, Region } from '@brawltome/bhapi'
import { clan, clanMember, player, playerAlias, playerRankedTeam } from '@brawltome/database'
import type { Database } from '@brawltome/database'
import { desc, eq, inArray, sql } from 'drizzle-orm'
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

  async function runTick() {
    const acquired = await acquireLock(deps.redis)
    if (!acquired) {
      console.log('[janitor] skipped: could not acquire lock')
      return
    }

    tick++
    lockValue = acquired
    const tickStart = performance.now()
    console.log(`[janitor] tick ${tick} starting...`)
    heartbeatTimer = setInterval(() => renewLock(deps.redis, lockValue), HEARTBEAT_INTERVAL_MS)

    const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const start = performance.now()
      const result = await fn()
      console.log(`[janitor] ${label} (${(performance.now() - start).toFixed(0)}ms)`)
      return result
    }

    try {
      const tokens = deps.bhapi.remainingTokens
      if (tokens < JANITOR_MIN_TOKENS) {
        console.log(`[janitor] tick ${tick} skipped: only ${tokens} tokens remaining`)
        return
      }

      // Hot pages every tick
      await time('hot 1v1', () => sync1v1Page(deps, 'all', 1, HOT_PAGES, 'cursor:hot:1v1'))
      await time('hot 2v2', () => sync2v2Page(deps, 'all', 1, HOT_PAGES, 'cursor:hot:2v2'))

      // Cold pages every N ticks
      if (tick % COLD_TICK_INTERVAL === 0) {
        await time('cold 1v1', () => sync1v1Page(deps, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:1v1'))
        await time('cold 2v2', () => sync2v2Page(deps, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:2v2'))
      }

      // Regional: rotate 1 region per tick
      const regionIndex = (tick - 1) % REGIONS.length
      const region = REGIONS[regionIndex]
      await time(`1v1 ${region}`, () => sync1v1Page(deps, region, 1, MAX_COLD_PAGE, `cursor:region:1v1:${region}`))
      await time(`2v2 ${region}`, () => sync2v2Page(deps, region, 1, MAX_COLD_PAGE, `cursor:region:2v2:${region}`))

      // Clan backfill
      await time('clan backfill', () => backfillClans(deps))

      const elapsed = ((performance.now() - tickStart) / 1000).toFixed(1)
      console.log(`[janitor] tick ${tick} complete in ${elapsed}s, ${deps.bhapi.remainingTokens} tokens remaining`)
    } catch (err) {
      console.error(`[janitor] tick ${tick} error:`, err)
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      await releaseLock(deps.redis, lockValue)
    }
  }

  let timer: Timer | null = null
  let stopped = false

  function schedule() {
    if (stopped) return
    timer = setTimeout(async () => {
      await runTick()
      schedule()
    }, 60_000)
  }

  schedule()

  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (lockValue) await releaseLock(deps.redis, lockValue)
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

async function advanceCursor(redis: Redis, cursorKey: string, startPage: number, maxPage: number): Promise<number> {
  const cursor = await redis.get(cursorKey)
  return cursor ? Math.max(startPage, Math.min(Number.parseInt(cursor, 10), maxPage)) : startPage
}

async function sync1v1Page(
  deps: JanitorDeps,
  region: Region | 'all',
  startPage: number,
  maxPage: number,
  cursorKey: string,
) {
  const page = await advanceCursor(deps.redis, cursorKey, startPage, maxPage)
  if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) return

  const rankings = await deps.bhapi.getRankings1v1(region as Region, page)

  if (rankings.length === 0) {
    await deps.redis.set(cursorKey, String(startPage))
    return
  }

  await savePlayers(deps, rankings)
  console.log(`[janitor] 1v1 ${region} page ${page}: ${rankings.length} players`)

  const nextPage = page + 1 > maxPage ? startPage : page + 1
  await deps.redis.set(cursorKey, String(nextPage))
}

async function sync2v2Page(
  deps: JanitorDeps,
  region: Region | 'all',
  startPage: number,
  maxPage: number,
  cursorKey: string,
) {
  const page = await advanceCursor(deps.redis, cursorKey, startPage, maxPage)
  if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) return

  const rankings = await deps.bhapi.getRankings2v2(region as Region, page)

  if (rankings.length === 0) {
    await deps.redis.set(cursorKey, String(startPage))
    return
  }

  await saveTeams(deps, rankings)
  console.log(`[janitor] 2v2 ${region} page ${page}: ${rankings.length} teams`)

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
  // Track aliases for name changes (requires existing data lookup)
  const ids = rankings.map((r) => r.brawlhalla_id)
  const existing = await deps.db.query.player.findMany({
    where: inArray(player.brawlhallaId, ids),
    columns: { brawlhallaId: true, name: true },
  })
  const nameMap = new Map(existing.map((p) => [p.brawlhallaId, p.name]))

  const aliases: (typeof playerAlias.$inferInsert)[] = []
  for (const r of rankings) {
    const oldName = nameMap.get(r.brawlhalla_id)
    if (oldName && oldName !== r.name) {
      aliases.push({ brawlhallaId: r.brawlhalla_id, key: oldName.toLowerCase(), value: oldName })
    }
  }
  if (aliases.length > 0) {
    await deps.db.insert(playerAlias).values(aliases).onConflictDoNothing()
  }

  // Batch upsert all players
  const now = new Date()
  const rows = rankings.map((r) => ({
    brawlhallaId: r.brawlhalla_id,
    name: r.name ?? '',
    region: r.region ?? null,
    rating: r.rating ?? 0,
    peakRating: r.peak_rating ?? 0,
    tier: r.tier ?? null,
    rankedGames: r.games ?? 0,
    rankedWins: r.wins ?? 0,
    bestLegend: r.best_legend ?? 0,
    bestLegendGames: r.best_legend_games ?? 0,
    bestLegendWins: r.best_legend_wins ?? 0,
  }))

  try {
    if (rows.length > 0) {
      await deps.db
        .insert(player)
        .values(rows as (typeof player.$inferInsert)[])
        .onConflictDoUpdate({
          target: player.brawlhallaId,
          set: {
            name: sql`excluded.name`,
            region: sql`excluded.region`,
            rating: sql`excluded.rating`,
            peakRating: sql`excluded.peak_rating`,
            tier: sql`excluded.tier`,
            rankedGames: sql`excluded.ranked_games`,
            rankedWins: sql`excluded.ranked_wins`,
            bestLegend: sql`excluded.best_legend`,
            bestLegendGames: sql`excluded.best_legend_games`,
            bestLegendWins: sql`excluded.best_legend_wins`,
            lastUpdated: now,
          },
        })
    }
  } catch (err) {
    console.error('[janitor] failed to batch save players:', err)
  }
}

async function saveTeams(deps: JanitorDeps, rankings: BhApiRanking2v2[]) {
  try {
    // Batch create placeholder players for all team members
    const playerRows: (typeof player.$inferInsert)[] = []
    for (const r of rankings) {
      const nameParts = (r.teamname ?? '').split('+')
      playerRows.push(
        { brawlhallaId: r.brawlhalla_id_one, name: nameParts[0]?.trim() ?? '', region: r.region ?? null, rating: 0 },
        { brawlhallaId: r.brawlhalla_id_two, name: nameParts[1]?.trim() ?? '', region: r.region ?? null, rating: 0 },
      )
    }
    if (playerRows.length > 0) {
      await deps.db.insert(player).values(playerRows).onConflictDoNothing()
    }

    // Batch upsert team rows (one per owner per team)
    const teamRows: (typeof playerRankedTeam.$inferInsert)[] = []
    for (const r of rankings) {
      const shared = {
        brawlhallaIdOne: r.brawlhalla_id_one,
        brawlhallaIdTwo: r.brawlhalla_id_two,
        teamName: r.teamname ?? '',
        rating: r.rating ?? 0,
        peakRating: r.peak_rating ?? 0,
        tier: r.tier ?? '',
        wins: r.wins ?? 0,
        games: r.games ?? 0,
        region: r.region ?? null,
        globalRank: r.rank ?? null,
      }
      teamRows.push({ brawlhallaId: r.brawlhalla_id_one, ...shared }, { brawlhallaId: r.brawlhalla_id_two, ...shared })
    }
    if (teamRows.length > 0) {
      await deps.db
        .insert(playerRankedTeam)
        .values(teamRows)
        .onConflictDoUpdate({
          target: [playerRankedTeam.brawlhallaId, playerRankedTeam.brawlhallaIdOne, playerRankedTeam.brawlhallaIdTwo],
          set: {
            teamName: sql`excluded.team_name`,
            rating: sql`excluded.rating`,
            peakRating: sql`excluded.peak_rating`,
            tier: sql`excluded.tier`,
            wins: sql`excluded.wins`,
            games: sql`excluded.games`,
            region: sql`excluded.region`,
            globalRank: sql`excluded.global_rank`,
          },
        })
    }
  } catch (err) {
    console.error('[janitor] failed to batch save teams:', err)
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
