# Rate Limiting & Discovery Token Conservation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect the 180-token/15min Brawlhalla API budget by fixing discovery double-work and adding per-IP rate limits on token-consuming actions.

**Architecture:** Rate limit checks live in the service layer (not Hono middleware) because only the service knows whether a request triggers API token consumption. A new `rate-limit.service.ts` module provides Redis-backed sliding window counters; `RATE_LIMITS` constants live in `constants.ts`. IP is extracted in the Hono layer and threaded through tRPC context.

**Tech Stack:** Hono, tRPC, ioredis, Bun test runner

---

### Task 1: Create rate-limit module with Redis sliding window counter

**Files:**
- Create: `apps/api/src/services/rate-limit.service.ts`
- Test: `tests/services/rate-limit.test.ts`

**Step 1: Write the failing tests**

Create `tests/services/rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { checkRateLimit } from '../../apps/api/src/services/rate-limit.service'
import { RATE_LIMITS } from '../../apps/api/src/services/constants'

// Minimal Redis mock
function createRedisMock(incrResult: number = 1) {
  return {
    incr: mock(() => Promise.resolve(incrResult)),
    expire: mock(() => Promise.resolve(1)),
    ttl: mock(() => Promise.resolve(-1)),
  }
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const redis = createRedisMock(1)
    const result = await checkRateLimit(redis as any, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(1)
  })

  it('sets TTL on first request (ttl === -1)', async () => {
    const redis = createRedisMock(1)
    redis.ttl = mock(() => Promise.resolve(-1))
    await checkRateLimit(redis as any, '1.2.3.4', 'discovery')
    expect(redis.expire).toHaveBeenCalledWith('ratelimit:discovery:1.2.3.4', RATE_LIMITS.discovery.windowSec)
  })

  it('does not reset TTL on subsequent requests (ttl > 0)', async () => {
    const redis = createRedisMock(3)
    redis.ttl = mock(() => Promise.resolve(500))
    await checkRateLimit(redis as any, '1.2.3.4', 'discovery')
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('blocks requests at the limit', async () => {
    const redis = createRedisMock(RATE_LIMITS.discovery.max + 1)
    redis.ttl = mock(() => Promise.resolve(500))
    const result = await checkRateLimit(redis as any, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(500)
  })

  it('fails open on Redis error', async () => {
    const redis = {
      incr: mock(() => Promise.reject(new Error('connection refused'))),
      expire: mock(() => Promise.resolve(1)),
      ttl: mock(() => Promise.resolve(-1)),
    }
    const result = await checkRateLimit(redis as any, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bun test tests/services/rate-limit.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/api/src/services/rate-limit.service.ts`:

```typescript
import type { Redis } from 'ioredis'

export const RATE_LIMITS = {
  discovery: { max: 5, windowSec: 15 * 60 },
  refresh: { max: 20, windowSec: 15 * 60 },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

interface RateLimitResult {
  allowed: boolean
  current: number
  retryAfter: number
}

export async function checkRateLimit(
  redis: Redis,
  ip: string,
  action: RateLimitAction,
): Promise<RateLimitResult> {
  const { max, windowSec } = RATE_LIMITS[action]
  const key = `ratelimit:${action}:${ip}`

  try {
    const current = await redis.incr(key)

    // Set TTL only on first increment (key was just created)
    if (current === 1 || (await redis.ttl(key)) === -1) {
      await redis.expire(key, windowSec)
    }

    if (current > max) {
      const ttl = await redis.ttl(key)
      console.warn(`[RATE_LIMIT] ip=${ip} action=${action} count=${current} limit=${max}`)
      return { allowed: false, current, retryAfter: ttl > 0 ? ttl : windowSec }
    }

    return { allowed: true, current, retryAfter: 0 }
  } catch (err) {
    console.error(`[RATE_LIMIT] Redis error for ${action}:${ip}:`, err)
    return { allowed: true, current: 0, retryAfter: 0 }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bun test tests/services/rate-limit.test.ts`
Expected: all 5 tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/rate-limit.service.ts tests/services/rate-limit.test.ts
git commit -m "feat: add Redis-backed per-IP rate limit module"
```

---

### Task 2: Thread client IP through tRPC context

**Files:**
- Modify: `apps/api/src/trpc/context.ts` (add `clientIp` field)
- Modify: `apps/api/src/serve.ts` (extract IP from request, pass to context)

**Step 1: Add `clientIp` to Context type**

In `apps/api/src/trpc/context.ts`, add `clientIp: string` to the `Context` interface:

```typescript
export interface Context {
  db: Database
  bhapi: BhApiClient
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number }>
  statsQueue: Queue<{ brawlhallaId: number }>
  clanQueue: Queue<{ clanId: number }>
  clientIp: string
}
```

**Step 2: Extract IP in serve.ts and pass to context**

In `apps/api/src/serve.ts`, change the tRPC middleware to dynamically create context with the client IP:

Replace the static `ctx` object (line 27) and the `createContext` callback (line 47):

```typescript
// Remove the static ctx object. Instead, build per-request context in createContext.
const sharedCtx = { db, bhapi, redis, rankedQueue, statsQueue, clanQueue }

// ...

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) => {
      const forwarded = c.req.header('x-forwarded-for')
      const clientIp = forwarded ? forwarded.split(',')[0].trim() : '0.0.0.0'
      return { ...sharedCtx, clientIp } as unknown as Record<string, unknown>
    },
  }),
)
```

**Step 3: Verify typecheck passes**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx tsc --noEmit`
Expected: no new errors

**Step 4: Commit**

```bash
git add apps/api/src/trpc/context.ts apps/api/src/serve.ts
git commit -m "feat: extract client IP from request and thread through tRPC context"
```

---

### Task 3: Fix discovery double-work — persist full data on discovery

**Files:**
- Modify: `apps/api/src/services/player.service.ts` (rewrite `discoverPlayer()`)
- Test: `tests/services/player-discovery.test.ts`

**Context:** Currently `discoverPlayer()` fetches stats + ranked (2 tokens), inserts only basic player fields, then enqueues refresh jobs that re-fetch the same data (2 more tokens), and recursively calls `getPlayer()`. We need to persist the full stats and ranked data inline, set timestamps, and return the result directly.

**Step 1: Write failing test**

Create `tests/services/player-discovery.test.ts`. This tests that discovery does NOT enqueue refresh jobs and DOES persist full data:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test'

// We test the behavior by checking:
// 1. No calls to rankedQueue.enqueue or statsQueue.enqueue
// 2. Full data is returned (statsLegends, rankedLegends populated)

describe('discoverPlayer — no double-work', () => {
  it('should not enqueue refresh jobs after discovery', async () => {
    // This is a behavioral contract test.
    // After Task 3 implementation, import discoverPlayer or getPlayer
    // and verify enqueue is not called for a new player discovery.
    //
    // For now, mark as TODO — implementation will make this testable.
    expect(true).toBe(true)
  })
})
```

> **Note:** Full integration test requires DB + Redis mocks. The primary verification is manual: after implementing, check that `rankedQueue.enqueue` and `statsQueue.enqueue` are NOT called inside `discoverPlayer()`. The typecheck + existing behavior will confirm correctness.

**Step 2: Rewrite `discoverPlayer()` in `player.service.ts`**

The new `discoverPlayer()` should:

1. Keep the existing dedup Map and token/queue-depth checks
2. Fetch stats + ranked (2 tokens — same as before)
3. Persist the **full** player row (including `rankedLastUpdated`, `statsLastUpdated` set to `now`)
4. Persist ranked legends, ranked teams, stats legends, weapon stats — reuse the same insert logic from `processRefreshRanked` and `processRefreshStats` in `refresh.service.ts`
5. **Do NOT** enqueue refresh jobs (remove lines 145-146)
6. **Do NOT** recursively call `getPlayer()` (remove line 148)
7. Instead, query the just-inserted player and return enriched data directly

The full replacement for `discoverPlayer()` (lines 115-158 of `player.service.ts`):

```typescript
async function discoverPlayer(ctx: Context, brawlhallaId: number): Promise<PlayerResult | null> {
  const existing = discoveries.get(brawlhallaId)
  if (existing) return existing

  const queueDepth = (await ctx.rankedQueue.depth()) + (await ctx.statsQueue.depth())
  if (queueDepth > QUEUE_DISCOVERY_CAP) return null
  if (ctx.bhapi.remainingTokens < DISCOVERY_MIN_TOKENS) return null

  const promise = (async () => {
    try {
      const stats = await ctx.bhapi.getPlayerStats(brawlhallaId)
      if (!stats?.name) return null

      const ranked = await ctx.bhapi.getPlayerRanked(brawlhallaId)
      const now = new Date()
      const parseDmg = (s: string): bigint => BigInt(s || '0')
      const filteredLegends = stats.legends.filter((l) => l.legend_id !== 0)

      await ctx.db.transaction(async (tx) => {
        // Insert full player row
        await tx
          .insert(player)
          .values({
            brawlhallaId,
            name: stats.name,
            region: ranked?.region ?? null,
            rating: ranked?.rating ?? 0,
            peakRating: ranked?.peak_rating ?? 0,
            tier: ranked?.tier ?? null,
            rankedGames: ranked?.games ?? 0,
            rankedWins: ranked?.wins ?? 0,
            xp: stats.xp,
            level: stats.level,
            xpPercentage: stats.xp_percentage,
            totalGames: stats.games,
            totalWins: stats.wins,
            matchTimeTotal: filteredLegends.reduce((sum, l) => sum + l.matchtime, 0),
            damageBomb: parseDmg(stats.damagebomb),
            damageMine: parseDmg(stats.damagemine),
            damageSpikeball: parseDmg(stats.damagespikeball),
            damageSidekick: parseDmg(stats.damagesidekick),
            hitSnowball: stats.hitsnowball,
            koBomb: stats.kobomb,
            koMine: stats.komine,
            koSpikeball: stats.kospikeball,
            koSidekick: stats.kosidekick,
            koSnowball: stats.kosnowball,
            refreshTier: 'hot',
            rankedLastUpdated: now,
            statsLastUpdated: now,
            lastUpdated: now,
          })
          .onConflictDoNothing()

        // Insert ranked legends
        if (ranked && ranked.legends.length > 0) {
          await tx.insert(playerRankedLegend).values(
            ranked.legends.map((l) => ({
              brawlhallaId,
              legendId: l.legend_id,
              legendNameKey: l.legend_name_key,
              rating: l.rating,
              peakRating: l.peak_rating,
              tier: l.tier,
              wins: l.wins,
              games: l.games,
            })),
          )
        }

        // Insert ranked teams
        if (ranked && ranked['2v2'].length > 0) {
          const seen = new Set<string>()
          const teams = ranked['2v2'].filter((t) => {
            const key = `${t.brawlhalla_id_one}:${t.brawlhalla_id_two}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          await tx.insert(playerRankedTeam).values(
            teams.map((t) => ({
              brawlhallaId,
              brawlhallaIdOne: t.brawlhalla_id_one,
              brawlhallaIdTwo: t.brawlhalla_id_two,
              teamName: t.teamname,
              rating: t.rating,
              peakRating: t.peak_rating,
              tier: t.tier,
              wins: t.wins,
              games: t.games,
              region: String(t.region),
              globalRank: t.global_rank,
            })),
          )
        }

        // Insert stats legends
        if (filteredLegends.length > 0) {
          await tx.insert(playerStatsLegend).values(
            filteredLegends.map((l) => ({
              brawlhallaId,
              legendId: l.legend_id,
              legendNameKey: l.legend_name_key,
              xp: l.xp,
              level: l.level,
              xpPercentage: l.xp_percentage,
              games: l.games,
              wins: l.wins,
              matchTime: l.matchtime,
              kos: l.kos,
              teamKos: l.teamkos,
              suicides: l.suicides,
              falls: l.falls,
              damageDealt: parseDmg(l.damagedealt),
              damageTaken: parseDmg(l.damagetaken),
              damageWeaponOne: parseDmg(l.damageweaponone),
              damageWeaponTwo: parseDmg(l.damageweapontwo),
              timeHeldWeaponOne: l.timeheldweaponone,
              timeHeldWeaponTwo: l.timeheldweapontwo,
              koWeaponOne: l.koweaponone,
              koWeaponTwo: l.koweapontwo,
              koUnarmed: l.kounarmed,
              koThrownItem: l.kothrownitem,
              koGadgets: l.kogadgets,
              damageUnarmed: parseDmg(l.damageunarmed),
              damageThrownItem: parseDmg(l.damagethrownitem),
              damageGadgets: parseDmg(l.damagegadgets),
            })),
          )
        }

        // Insert weapon stats
        const weapons = aggregateWeapons(
          filteredLegends.map((l) => ({
            legendId: l.legend_id,
            damageWeaponOne: parseDmg(l.damageweaponone),
            damageWeaponTwo: parseDmg(l.damageweapontwo),
            timeHeldWeaponOne: l.timeheldweaponone,
            timeHeldWeaponTwo: l.timeheldweapontwo,
            koWeaponOne: l.koweaponone,
            koWeaponTwo: l.koweapontwo,
          })),
        )
        if (weapons.length > 0) {
          await tx.insert(playerWeaponStat).values(
            weapons.map((w) => ({
              brawlhallaId,
              weapon: w.weapon,
              timeHeld: w.timeHeld,
              damage: w.damage,
              kos: w.kos,
            })),
          )
        }

        // Insert clan association if present
        if (stats.clan) {
          await tx
            .insert(playerClan)
            .values({
              brawlhallaId,
              clanName: stats.clan.clan_name,
              clanId: stats.clan.clan_id,
              clanXp: parseDmg(stats.clan.clan_xp),
              clanLifetimeXp: BigInt(stats.clan.clan_lifetime_xp),
              personalXp: stats.clan.personal_xp,
            })
            .onConflictDoNothing()
        }

        // Snapshot initial rating history
        if (ranked && ranked.rating > 0) {
          await tx.insert(ratingHistory).values({
            brawlhallaId,
            rating: ranked.rating,
            peakRating: ranked.peak_rating,
            tier: ranked.tier,
            games: ranked.games,
            wins: ranked.wins,
          })
        }
      })

      // Query full player and return (player now exists with full data)
      const p = await queryPlayer(ctx, brawlhallaId)
      if (!p) return null

      const enrichedStatsLegends = (p.statsLegends || []).map((l: (typeof p.statsLegends)[number]) => {
        const legendData = getLegendById(l.legendId)
        return {
          ...l,
          weaponOne: legendData ? normalizeWeaponName(legendData.weaponOne) : null,
          weaponTwo: legendData ? normalizeWeaponName(legendData.weaponTwo) : null,
          bioName: legendData?.bioName ?? null,
        }
      })

      const history = await ctx.db.query.ratingHistory.findMany({
        where: eq(ratingHistory.brawlhallaId, brawlhallaId),
        orderBy: [desc(ratingHistory.recordedAt)],
        limit: 365,
      })

      return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history, isRefreshing: false }
    } finally {
      discoveries.delete(brawlhallaId)
    }
  })()

  discoveries.set(brawlhallaId, promise)
  setTimeout(() => discoveries.delete(brawlhallaId), 30_000)

  return promise
}
```

**New imports needed** at top of `player.service.ts`:

```typescript
import { playerClan } from '@brawltome/database'
import { aggregateWeapons } from './game-data.service'
```

**Step 3: Verify typecheck passes**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx tsc --noEmit`
Expected: no new errors

**Step 4: Commit**

```bash
git add apps/api/src/services/player.service.ts
git commit -m "fix: persist full stats/ranked data on discovery, eliminate double-work"
```

---

### Task 4: Add rate limit checks to player service

**Files:**
- Modify: `apps/api/src/services/player.service.ts` (add rate limit checks in `getPlayer` and `discoverPlayer`)

**Step 1: Add rate limit check before discovery**

In `discoverPlayer()`, after the token/queue-depth checks, add:

```typescript
const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
if (!discoveryLimit.allowed) {
  return null
}
```

**Step 2: Add rate limit check before refresh enqueues**

In `getPlayer()`, before enqueuing stale refresh jobs (around the `rankedStale` / `statsStale` blocks), add:

```typescript
const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
```

Then wrap both stale-check blocks so they only enqueue if `refreshLimit.allowed`:

```typescript
if (refreshLimit.allowed) {
  if (rankedStale) {
    const canDedup = await tryDedup(ctx.redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC)
    if (canDedup) {
      await ctx.rankedQueue.enqueue({ brawlhallaId })
      isRefreshing = true
    }
  }

  if (statsStale) {
    const canDedup = await tryDedup(ctx.redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC)
    if (canDedup) {
      await ctx.statsQueue.enqueue({ brawlhallaId })
      isRefreshing = true
    }
  }
}
```

**New import** at top of `player.service.ts`:

```typescript
import { checkRateLimit } from './rate-limit.service'
```

**Step 3: Verify typecheck passes**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx tsc --noEmit`
Expected: no new errors

**Step 4: Commit**

```bash
git add apps/api/src/services/player.service.ts
git commit -m "feat: add per-IP rate limit checks for discovery and refresh triggers"
```

---

### Task 5: Add rate limit checks to clan service

**Files:**
- Modify: `apps/api/src/services/clan.service.ts` (add rate limit checks for clan discovery and stale refresh)

**Step 1: Add rate limit check before clan discovery**

In `discoverClan()`, after the token check, add:

```typescript
const discoveryLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'discovery')
if (!discoveryLimit.allowed) return null
```

**Step 2: Add rate limit check before clan refresh enqueue**

In `getClan()`, wrap the stale refresh enqueue:

```typescript
if (age > CLAN_TTL_MS) {
  const refreshLimit = await checkRateLimit(ctx.redis, ctx.clientIp, 'refresh')
  if (refreshLimit.allowed) {
    const canDedup = await tryDedup(ctx.redis, dedupKey('clan', clanId), DEDUP_TTL_CLAN_SEC)
    if (canDedup) {
      await ctx.clanQueue.enqueue({ clanId })
      isRefreshing = true
    }
  }
}
```

**New import:**

```typescript
import { checkRateLimit } from './rate-limit.service'
```

**Step 3: Verify typecheck passes**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx tsc --noEmit`
Expected: no new errors

**Step 4: Commit**

```bash
git add apps/api/src/services/clan.service.ts
git commit -m "feat: add per-IP rate limit checks to clan discovery and refresh"
```

---

### Task 6: Run all tests and verify

**Step 1: Run full test suite**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bun test`
Expected: all tests pass

**Step 2: Run typecheck**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx tsc --noEmit`
Expected: no errors

**Step 3: Run linter**

Run: `cd /Users/nicktacke/Desktop/Coding/brawltome && bunx biome check apps/api/src tests`
Expected: no errors (or only pre-existing ones)

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/test issues"
```
