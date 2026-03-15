# Rate Limiting & Discovery Token Conservation

## Problem

The Brawlhalla API has a hard limit of 180 requests per 15 minutes. With ~60k page views/day, there is no per-user/per-IP rate limiting — a single user can exhaust the entire token budget, starving all other users. Additionally, `discoverPlayer()` wastes 2 tokens per discovery by re-fetching data it already has.

## Design

### 1. Fix discovery double-work

`discoverPlayer()` currently:
1. Fetches `getPlayerStats()` + `getPlayerRanked()` (2 tokens)
2. Inserts a bare-bones player row (discards full stats/ranked data)
3. Enqueues ranked + stats refresh jobs (2 more tokens when processed)
4. Calls `getPlayer()` recursively, which may try to enqueue again

**Fix:** Persist full stats/ranked data during discovery. Set `rankedLastUpdated` and `statsLastUpdated` to now. Remove refresh enqueues and recursive `getPlayer()` call. Return data directly.

**Result:** Discovery drops from ~4 tokens to 2 tokens.

### 2. Per-IP rate limiting on token-consuming actions

Only actions that consume Brawlhalla API tokens are rate limited. Cached reads are unlimited.

**Mechanism:** Sliding window counter in Redis (`INCR` + `EXPIRE`).

**Limits:**

| Action | Limit | On exceed |
|--------|-------|-----------|
| Discovery (uncached player) | 5 per 15 min per IP | Return 429 with Retry-After |
| Refresh triggers (stale player view) | 20 per 15 min per IP | Silently serve stale data |

**Where checks happen:** In the service layer (`player.service.ts`, `clan.service.ts`), not as Hono middleware — the service layer knows whether a player is cached/stale.

**IP extraction:** `X-Forwarded-For` header (Coolify reverse proxy) with fallback to direct connection IP. Passed through tRPC context.

**Redis failure:** Fail open (allow the request, log the error).

### 3. Logging

`console.warn` with structured format when a rate limit is hit:
```
[RATE_LIMIT] ip=1.2.3.4 action=discovery count=6 limit=5
```

Greppable in Coolify logs. No aggregation or alerting.

## Files touched

- `apps/api/src/services/player.service.ts` — discovery fix + rate limit checks
- `apps/api/src/services/refresh.service.ts` — extract persistence logic for reuse in discovery
- `apps/api/src/middleware/rate-limit.ts` (new) — Redis counter helpers + logging
- `apps/api/src/serve.ts` — IP extraction, pass IP through tRPC context

## Out of scope

- Rate limiting cached reads (no token cost)
- Escalating bans / IP blocking
- Admin dashboard (separate feature, tracked separately)
- Global DoS protection on cached endpoints
- Authentication / API keys

## Edge cases

- **Shared IP (NAT/VPN):** Limits are generous enough (5 discovery / 20 refresh) for normal multi-user use behind one IP.
- **Redis down:** Fail open — allow request, log error.
- **Clan browsing:** A user clicking through uncached clan members hits the discovery limit at 5, which is acceptable. They can still view cached members freely.
