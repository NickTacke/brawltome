import type { BhApiClient, BhApiRanking2v2, Region } from '@brawltome/bhapi'
import { clan, clanMember, player, playerAlias, playerRankedTeam } from '@brawltome/database'
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
    if (!acquired) {
      console.log('[janitor] skipped: could not acquire lock')
      return
    }

    tick++
    lockValue = acquired
    console.log(`[janitor] tick ${tick} starting...`)
    heartbeatTimer = setInterval(() => renewLock(deps.redis, lockValue), HEARTBEAT_INTERVAL_MS)

    try {
      const tokens = deps.bhapi.remainingTokens
      if (tokens < JANITOR_MIN_TOKENS) {
        console.log(`[janitor] tick ${tick} skipped: only ${tokens} tokens remaining`)
        return
      }

      // Hot pages every tick
      console.log('[janitor] syncing hot 1v1...')
      await sync1v1Page(deps, 'all', 1, HOT_PAGES, 'cursor:hot:1v1')
      console.log('[janitor] syncing hot 2v2...')
      await sync2v2Page(deps, 'all', 1, HOT_PAGES, 'cursor:hot:2v2')

      // Cold pages every N ticks
      if (tick % COLD_TICK_INTERVAL === 0) {
        await sync1v1Page(deps, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:1v1')
        await sync2v2Page(deps, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:2v2')
      }

      // Regional: rotate 1 region per tick
      const regionIndex = (tick - 1) % REGIONS.length
      const region = REGIONS[regionIndex]
      await sync1v1Page(deps, region, 1, MAX_COLD_PAGE, `cursor:region:1v1:${region}`)
      await sync2v2Page(deps, region, 1, MAX_COLD_PAGE, `cursor:region:2v2:${region}`)

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

  return async () => {
    clearInterval(interval)
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

  console.log(`[janitor] 1v1 ${region} page ${page}: ${rankings.length} players`)
  await savePlayers(deps, rankings)

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

  console.log(`[janitor] 2v2 ${region} page ${page}: ${rankings.length} teams`)
  await saveTeams(deps, rankings)

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
    try {
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
      }

      const insertValues: Record<string, unknown> = {
        brawlhallaId: r.brawlhalla_id,
        ...shared,
      }
      const updateValues: Record<string, unknown> = {
        ...shared,
        lastUpdated: now,
      }
      if (isValhallan) {
        insertValues.valhallanConfirmedAt = now
        updateValues.valhallanConfirmedAt = now
      }

      await deps.db
        .insert(player)
        .values(insertValues as typeof player.$inferInsert)
        .onConflictDoUpdate({
          target: player.brawlhallaId,
          set: updateValues,
        })
    } catch (err) {
      console.error(`[janitor] failed to save player ${r.brawlhalla_id}:`, err)
    }
  }
}

async function saveTeams(deps: JanitorDeps, rankings: BhApiRanking2v2[]) {
  for (const r of rankings) {
    try {
      // Ensure both players exist in the player table
      for (const id of [r.brawlhalla_id_one, r.brawlhalla_id_two]) {
        const namePart = r.teamname.split('+')
        const name = id === r.brawlhalla_id_one ? (namePart[0]?.trim() ?? '') : (namePart[1]?.trim() ?? '')

        await deps.db
          .insert(player)
          .values({
            brawlhallaId: id,
            name,
            region: r.region ?? null,
            rating: 0,
          })
          .onConflictDoNothing()
      }

      // Insert team for both players (each player owns their team rows)
      for (const ownerId of [r.brawlhalla_id_one, r.brawlhalla_id_two]) {
        await deps.db
          .insert(playerRankedTeam)
          .values({
            brawlhallaId: ownerId,
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
          })
          .onConflictDoUpdate({
            target: [playerRankedTeam.brawlhallaId, playerRankedTeam.brawlhallaIdOne, playerRankedTeam.brawlhallaIdTwo],
            set: {
              teamName: r.teamname ?? '',
              rating: r.rating ?? 0,
              peakRating: r.peak_rating ?? 0,
              tier: r.tier ?? '',
              wins: r.wins ?? 0,
              games: r.games ?? 0,
              region: r.region ?? null,
              globalRank: r.rank ?? null,
            },
          })
      }
    } catch (err) {
      console.error(`[janitor] failed to save team ${r.brawlhalla_id_one}+${r.brawlhalla_id_two}:`, err)
    }
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
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

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
