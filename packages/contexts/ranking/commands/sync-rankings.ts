import type { BhApiClient, BhApiRanking2v2, Region } from '@brawltome/bhapi'
import type { Database } from '@brawltome/database'
import { type PlayerRepo, createPlayerRepo } from '@brawltome/player'
import type { MetricsRegistry, Queue } from '@brawltome/shared'
import type { Redis } from 'ioredis'
import { JANITOR_MIN_TOKENS } from '../ranking'

const REGIONS: Region[] = ['us-e', 'eu', 'sea', 'brz', 'aus', 'us-w', 'jpn', 'me', 'sa']
const HOT_PAGES = 10
const MAX_COLD_PAGE = 200
const COLD_TICK_INTERVAL = 10
const LOCK_KEY = 'janitor:lock'
const LOCK_TTL_SEC = 60
const HEARTBEAT_INTERVAL_MS = 20_000

const RENEW_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`

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
  rankedQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  statsQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  clanQueue: Queue<{ clanId: number; caller: 'on-demand' | 'background' }>
  metrics?: MetricsRegistry
}

export function startJanitor(deps: JanitorDeps) {
  const playerRepo = createPlayerRepo(deps.db)
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
      const tokens = deps.bhapi.remainingTokens('background')
      if (tokens < JANITOR_MIN_TOKENS) {
        console.log(`[janitor] tick ${tick} skipped: only ${tokens} tokens remaining`)
        return
      }

      // Hot pages every tick
      await time('hot 1v1', () => sync1v1Page(deps, playerRepo, 'all', 1, HOT_PAGES, 'cursor:hot:1v1'))
      await time('hot 2v2', () => sync2v2Page(deps, playerRepo, 'all', 1, HOT_PAGES, 'cursor:hot:2v2'))

      // Cold pages every N ticks
      if (tick % COLD_TICK_INTERVAL === 0) {
        await time('cold 1v1', () =>
          sync1v1Page(deps, playerRepo, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:1v1'),
        )
        await time('cold 2v2', () =>
          sync2v2Page(deps, playerRepo, 'all', HOT_PAGES + 1, MAX_COLD_PAGE, 'cursor:cold:2v2'),
        )
      }

      // Regional: rotate 1 region per tick
      const regionIndex = (tick - 1) % REGIONS.length
      const region = REGIONS[regionIndex]
      await time(`1v1 ${region}`, () =>
        sync1v1Page(deps, playerRepo, region, 1, MAX_COLD_PAGE, `cursor:region:1v1:${region}`),
      )
      await time(`2v2 ${region}`, () =>
        sync2v2Page(deps, playerRepo, region, 1, MAX_COLD_PAGE, `cursor:region:2v2:${region}`),
      )

      const elapsed = ((performance.now() - tickStart) / 1000).toFixed(1)
      console.log(`[janitor] tick ${tick} complete in ${elapsed}s, ${deps.bhapi.remainingTokens('background')} tokens remaining`)
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

async function advanceCursor(redis: Redis, cursorKey: string, startPage: number, maxPage: number): Promise<number> {
  const cursor = await redis.get(cursorKey)
  return cursor ? Math.max(startPage, Math.min(Number.parseInt(cursor, 10), maxPage)) : startPage
}

async function sync1v1Page(
  deps: JanitorDeps,
  playerRepo: PlayerRepo,
  region: Region | 'all',
  startPage: number,
  maxPage: number,
  cursorKey: string,
) {
  const page = await advanceCursor(deps.redis, cursorKey, startPage, maxPage)
  if (deps.bhapi.remainingTokens('background') < JANITOR_MIN_TOKENS) return

  const rankings = await deps.bhapi.getRankings1v1(region as Region, page, { caller: 'background' })

  if (rankings.length === 0) {
    await deps.redis.set(cursorKey, String(startPage))
    return
  }

  await savePlayers(playerRepo, rankings)
  console.log(`[janitor] 1v1 ${region} page ${page}: ${rankings.length} players`)

  const nextPage = page + 1 > maxPage ? startPage : page + 1
  await deps.redis.set(cursorKey, String(nextPage))
}

async function sync2v2Page(
  deps: JanitorDeps,
  playerRepo: PlayerRepo,
  region: Region | 'all',
  startPage: number,
  maxPage: number,
  cursorKey: string,
) {
  const page = await advanceCursor(deps.redis, cursorKey, startPage, maxPage)
  if (deps.bhapi.remainingTokens('background') < JANITOR_MIN_TOKENS) return

  const rankings = await deps.bhapi.getRankings2v2(region as Region, page, { caller: 'background' })

  if (rankings.length === 0) {
    await deps.redis.set(cursorKey, String(startPage))
    return
  }

  await saveTeams(playerRepo, rankings)
  console.log(`[janitor] 2v2 ${region} page ${page}: ${rankings.length} teams`)

  const nextPage = page + 1 > maxPage ? startPage : page + 1
  await deps.redis.set(cursorKey, String(nextPage))
}

async function savePlayers(
  repo: PlayerRepo,
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
  const ids = rankings.map((r) => r.brawlhalla_id)
  const nameMap = await repo.getExistingPlayerNames(ids)

  const aliases: Array<{ brawlhallaId: number; key: string; value: string }> = []
  for (const r of rankings) {
    const oldName = nameMap.get(r.brawlhalla_id)
    if (oldName && oldName !== r.name) {
      aliases.push({ brawlhallaId: r.brawlhalla_id, key: oldName.toLowerCase(), value: oldName })
    }
  }
  await repo.batchInsertAliases(aliases)

  try {
    await repo.batchUpsertPlayers(rankings)
  } catch (err) {
    console.error('[janitor] failed to batch save players:', err)
  }
}

async function saveTeams(repo: PlayerRepo, rankings: BhApiRanking2v2[]) {
  try {
    const seenPlayers = new Set<number>()
    const playerRows: Array<{ brawlhallaId: number; name: string; region: string | null; rating: number }> = []
    for (const r of rankings) {
      const nameParts = (r.teamname ?? '').split('+')
      for (const [id, name] of [
        [r.brawlhalla_id_one, nameParts[0]?.trim() ?? ''],
        [r.brawlhalla_id_two, nameParts[1]?.trim() ?? ''],
      ] as [number, string][]) {
        if (!seenPlayers.has(id)) {
          seenPlayers.add(id)
          playerRows.push({ brawlhallaId: id, name, region: r.region ?? null, rating: 0 })
        }
      }
    }
    await repo.batchUpsertPlaceholderPlayers(playerRows)

    const seen = new Set<string>()
    const teamRows: Array<{
      brawlhallaId: number
      brawlhallaIdOne: number
      brawlhallaIdTwo: number
      teamName: string
      rating: number
      peakRating: number
      tier: string
      wins: number
      games: number
      region: string | null
      globalRank: number | null
    }> = []
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
      for (const ownerId of [r.brawlhalla_id_one, r.brawlhalla_id_two]) {
        const key = `${ownerId}:${r.brawlhalla_id_one}:${r.brawlhalla_id_two}`
        if (!seen.has(key)) {
          seen.add(key)
          teamRows.push({ brawlhallaId: ownerId, ...shared })
        }
      }
    }
    await repo.batchUpsertTeams(teamRows)
  } catch (err) {
    console.error('[janitor] failed to batch save teams:', err)
  }
}
