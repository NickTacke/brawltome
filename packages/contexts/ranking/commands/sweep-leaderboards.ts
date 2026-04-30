import type { PlayerRepo } from '@brawltome/player'
import type { MetricsRegistry } from '@brawltome/shared'
import type { Redis } from 'ioredis'
import { type Bracket, type PageEntry, type PageResponse, fetchLeaderboardPage } from './leaderboard-endpoint'
import { type TierFallbackKind, normalizeRegion, resolveTier } from './sweep-helpers'

export interface SweepBracketDeps {
  bracket: Bracket
  region: string
  repo: PlayerRepo
  fetchPage?: (opts: { bracket: Bracket; page: number; region: string }) => Promise<PageResponse>
  concurrency?: number
  onTierFallback?: (kind: Exclude<TierFallbackKind, 'none'>) => void
}

export interface SweepBracketResult {
  pagesOk: number
  pagesSkipped: number
  pagesFailed: number
  rowsWritten: number
  durationMs: number
}

// Concurrency 10 (down from 20) reduces upstream pressure — production traffic
// produced clustered 502s at 20 even with retries. Sweep wall-clock is ~8-10min
// at 10, still well under the 15min cadence.
const DEFAULT_CONCURRENCY = 10

// Cap per-region pagination at 300 pages × 50 entries = 15k players. Even the
// largest regions don't have more legitimate ranked players than this; smaller
// regions naturally stop earlier via `total_pages`.
const MAX_PAGES_PER_REGION = 300

export async function sweepBracket(deps: SweepBracketDeps): Promise<SweepBracketResult> {
  const fetchPage = deps.fetchPage ?? fetchLeaderboardPage
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const onTierFallback = deps.onTierFallback ?? (() => {})

  const start = performance.now()
  let pagesOk = 0
  let pagesSkipped = 0
  let pagesFailed = 0
  let rowsWritten = 0

  let firstPage: PageResponse
  try {
    firstPage = await fetchPage({ bracket: deps.bracket, page: 1, region: deps.region })
  } catch (err) {
    console.error(`[sweep] ${deps.bracket} ${deps.region}: failed to fetch page 1:`, err)
    pagesSkipped++
    return { pagesOk, pagesSkipped, pagesFailed, rowsWritten, durationMs: performance.now() - start }
  }
  const totalPages = Math.min(firstPage.total_pages, MAX_PAGES_PER_REGION)
  try {
    const written = await writePage(deps.bracket, firstPage.rankings, deps.repo, onTierFallback)
    pagesOk++
    rowsWritten += written
  } catch (err) {
    console.error(`[sweep] ${deps.bracket} ${deps.region} page 1 write failed:`, err)
    pagesFailed++
  }

  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2)
  // Workers race on cursor++. Safe because JS is single-threaded and cursor++
  // happens between awaits, so no two workers can read the same idx. Adding any
  // await between cursor++ and pageNumbers[idx] would break this.
  let cursor = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = cursor++
        if (idx >= pageNumbers.length) return
        const page = pageNumbers[idx]
        let res: PageResponse
        try {
          res = await fetchPage({ bracket: deps.bracket, page, region: deps.region })
        } catch (err) {
          console.error(`[sweep] ${deps.bracket} ${deps.region} page ${page} fetch skipped:`, err)
          pagesSkipped++
          continue
        }
        try {
          const w = await writePage(deps.bracket, res.rankings, deps.repo, onTierFallback)
          pagesOk++
          rowsWritten += w
        } catch (err) {
          console.error(`[sweep] ${deps.bracket} ${deps.region} page ${page} write failed:`, err)
          pagesFailed++
        }
      }
    }),
  )

  return { pagesOk, pagesSkipped, pagesFailed, rowsWritten, durationMs: performance.now() - start }
}

async function writePage(
  bracket: Bracket,
  entries: PageEntry[],
  repo: PlayerRepo,
  onTierFallback: (kind: Exclude<TierFallbackKind, 'none'>) => void,
): Promise<number> {
  if (entries.length === 0) return 0
  if (bracket === '1v1' || bracket === '3v3') {
    type SoloRow = {
      brawlhallaId: number
      name: string
      region: string
      rating: number
      peakRating: number
      tier: string
      wins: number
      losses: number
    }
    const rows: SoloRow[] = []
    for (const e of entries) {
      const id = e.id ?? e.players?.[0]?.id
      if (id === undefined) {
        console.warn(`[sweep] ${bracket} skipping entry with no id:`, JSON.stringify(e))
        continue
      }
      const name = e.username ?? e.players?.[0]?.username ?? `Player ${id}`
      const region = normalizeRegion(e.region ?? '')
      const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
      if (fallback !== 'none') onTierFallback(fallback)
      rows.push({
        brawlhallaId: id,
        name,
        region,
        rating: e.rating,
        peakRating: e.best_rating,
        tier,
        wins: e.wins,
        losses: e.losses,
      })
    }
    if (bracket === '1v1') await repo.sweepUpsert1v1(rows)
    else await repo.sweepUpsert3v3(rows)
    return rows.length
  }

  if (bracket === '2v2') {
    const teams = entries
      .filter((e): e is PageEntry & { players: { id: number; username: string }[] } => e.players?.length === 2)
      .map((e) => {
        const region = normalizeRegion(e.region ?? '')
        const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
        if (fallback !== 'none') onTierFallback(fallback)
        const players = e.players
        return {
          brawlhallaIdOne: players[0].id,
          brawlhallaIdTwo: players[1].id,
          // Surfacing real usernames (vs the legacy `Player {id}` placeholder) is the only
          // place 2v2-only players ever get a real name in the player table — 1v1/3v3 sweeps
          // never see them.
          playerOneName: players[0].username ?? `Player ${players[0].id}`,
          playerTwoName: players[1].username ?? `Player ${players[1].id}`,
          teamName: '',
          rating: e.rating,
          peakRating: e.best_rating,
          tier,
          wins: e.wins,
          losses: e.losses,
          region,
        }
      })
    await repo.sweepUpsert2v2(teams)
    return teams.length
  }

  const rows = entries
    .filter((e): e is PageEntry & { players: { id: number; username: string }[] } => e.players?.length === 1)
    .map((e) => {
      const region = normalizeRegion(e.region ?? '')
      const { tier, fallback } = resolveTier({ apiTier: e.tier, bestRating: e.best_rating })
      if (fallback !== 'none') onTierFallback(fallback)
      const p = e.players[0]
      return {
        brawlhallaId: p.id,
        name: p.username,
        teamName: '',
        rating: e.rating,
        peakRating: e.best_rating,
        tier,
        wins: e.wins,
        losses: e.losses,
        region,
      }
    })
  await repo.sweepUpsertSolo2v2(rows)
  return rows.length
}

const LOCK_KEY = 'sweep:lock'
const LOCK_TTL_SEC = 60
const HEARTBEAT_INTERVAL_MS = 20_000
const TICK_INTERVAL_MS = 60_000
const SWEEP_INTERVAL_MS = 15 * 60_000

const RENEW_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`
const RELEASE_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`

const BRACKETS: Bracket[] = ['1v1', '2v2', 'solo_2v2', '3v3']
const REGIONS: string[] = ['US-E', 'EU', 'SEA', 'BRZ', 'AUS', 'US-W', 'JPN', 'ME', 'SA']

export interface StartSweepDeps {
  redis: Redis
  repo: PlayerRepo
  metrics: MetricsRegistry
  fetchPage?: (opts: { bracket: Bracket; page: number; region: string }) => Promise<PageResponse>
  concurrency?: number
  tickIntervalMs?: number
  sweepIntervalMs?: number
}

export function startSweep(deps: StartSweepDeps): () => Promise<void> {
  const tickInterval = deps.tickIntervalMs ?? TICK_INTERVAL_MS
  const sweepInterval = deps.sweepIntervalMs ?? SWEEP_INTERVAL_MS

  let stopped = false
  let lastSweepStart = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(tick, tickInterval)
  }

  const tick = async () => {
    if (stopped) return
    // Outer try/finally guarantees the loop reschedules itself on ANY thrown error
    // (e.g. transient Redis outage in acquireLock/releaseLock). Without this, an
    // unhandled throw from acquireLock would silently kill the worker until restart.
    try {
      if (Date.now() - lastSweepStart < sweepInterval) {
        return
      }
      let lockValue: string | null = null
      try {
        lockValue = await acquireLock(deps.redis)
      } catch (err) {
        console.error('[sweep] acquireLock failed, will retry next tick:', err)
        return
      }
      if (!lockValue) {
        return
      }
      lastSweepStart = Date.now()
      let lockLost = false
      // Any heartbeat failure (lock-not-ours OR Redis error) marks the lock lost. If Redis stays
      // unreachable past LOCK_TTL_SEC the key TTL-expires and another instance can take it, so
      // we must not assume we still own the lock during a transient outage.
      heartbeatTimer = setInterval(() => {
        renewLock(deps.redis, lockValue)
          .then((ok) => {
            if (ok) return
            console.error('[sweep] lock lost during heartbeat')
            lockLost = true
            deps.metrics.incrementCounter('sweep:lock_lost_total').catch(() => {})
          })
          .catch((err) => {
            console.error('[sweep] heartbeat error, treating lock as lost:', err)
            lockLost = true
            deps.metrics.incrementCounter('sweep:lock_lost_total').catch(() => {})
          })
      }, HEARTBEAT_INTERVAL_MS)

      inFlight = (async () => {
        try {
          const sweepStart = performance.now()
          for (const bracket of BRACKETS) {
            if (lockLost || stopped) break
            let bracketPagesOk = 0
            let bracketPagesSkipped = 0
            let bracketPagesFailed = 0
            for (const region of REGIONS) {
              if (lockLost || stopped) break
              const r = await sweepBracket({
                bracket,
                region,
                repo: deps.repo,
                fetchPage: deps.fetchPage,
                concurrency: deps.concurrency,
                onTierFallback: (kind) => {
                  const counter = kind === 'diamond' ? 'sweep:tier_fallback_diamond' : 'sweep:tier_unexpected_null'
                  deps.metrics.incrementCounter(counter).catch(() => {})
                },
              })
              bracketPagesOk += r.pagesOk
              bracketPagesSkipped += r.pagesSkipped
              bracketPagesFailed += r.pagesFailed
              console.log(
                `[sweep] ${bracket} ${region}: ${r.pagesOk} ok, ${r.pagesSkipped} skipped, ${r.pagesFailed} failed, ${r.rowsWritten} rows, ${r.durationMs.toFixed(0)}ms`,
              )
            }
            if (bracketPagesOk > 0)
              await deps.metrics.incrementCounter(`sweep:${bracket}:pages_ok`, bracketPagesOk).catch(() => {})
            if (bracketPagesSkipped > 0)
              await deps.metrics.incrementCounter(`sweep:${bracket}:pages_skipped`, bracketPagesSkipped).catch(() => {})
            if (bracketPagesFailed > 0)
              await deps.metrics.incrementCounter(`sweep:${bracket}:pages_failed`, bracketPagesFailed).catch(() => {})
          }
          const elapsed = performance.now() - sweepStart
          console.log(`[sweep] cycle complete in ${(elapsed / 1000).toFixed(1)}s`)
        } catch (err) {
          console.error('[sweep] cycle error:', err)
        } finally {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
          }
          if (!lockLost) {
            try {
              await releaseLock(deps.redis, lockValue)
            } catch (err) {
              console.error('[sweep] releaseLock failed (lock will TTL-expire):', err)
            }
          } else {
            lastSweepStart = 0 // allow next tick to retry without waiting for the cadence
          }
        }
      })()
      // Block re-scheduling until the in-flight sweep finishes. This guards against a tick firing
      // while a sweep is still running on the same instance, without the await, we'd re-enter
      // tick() with a stale lastSweepStart and could double-fire.
      await inFlight
      inFlight = null
    } finally {
      schedule()
    }
  }

  schedule()

  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (inFlight) await inFlight.catch(() => {})
  }
}

async function acquireLock(redis: Redis): Promise<string | null> {
  const value = crypto.randomUUID()
  const result = await redis.set(LOCK_KEY, value, 'EX', LOCK_TTL_SEC, 'NX')
  return result === 'OK' ? value : null
}

async function renewLock(redis: Redis, value: string): Promise<boolean> {
  const result = await redis.call('EVAL', RENEW_LOCK_SCRIPT, '1', LOCK_KEY, value, String(LOCK_TTL_SEC))
  return result !== 0
}

async function releaseLock(redis: Redis, value: string): Promise<void> {
  await redis.call('EVAL', RELEASE_LOCK_SCRIPT, '1', LOCK_KEY, value)
}
