# BrawlTome v2 — Full Rewrite Design

## Overview

Complete rewrite of BrawlTome from scratch. Migrates from Node.js/Nx/NestJS/Prisma/BullMQ to Bun/Hono/tRPC/Drizzle with a Bun-native queue. Deployed on Coolify (Hetzner) with Cloudflare in front.

## Tech Stack

| Layer             | v1                      | v2                       |
| ----------------- | ----------------------- | ------------------------ |
| Runtime           | Node.js + pnpm          | Bun                      |
| Monorepo          | Nx                      | Bun workspaces           |
| Backend           | NestJS + REST           | Hono + tRPC              |
| ORM               | Prisma                  | Drizzle                  |
| Queue             | BullMQ                  | Bun-native Redis Streams |
| Testing           | Vitest + SWC            | Bun test                 |
| Frontend fetching | SWR client-side         | RSC + Suspense streaming |
| Hosting           | Vercel/Railway/Supabase | Coolify + Cloudflare     |

## Monorepo Structure

```
brawltome/
├── apps/
│   ├── api/              # Hono + tRPC server (API + worker entrypoints)
│   │   ├── src/
│   │   │   ├── router/         # tRPC routers (player, clan, leaderboard, search)
│   │   │   ├── services/       # Business logic (refresh, janitor, rate-limiter)
│   │   │   ├── queue/          # Bun-native Redis Streams queue
│   │   │   ├── serve.ts        # API entrypoint (Hono + tRPC)
│   │   │   └── worker.ts       # Worker entrypoint (queue consumer + janitor)
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── web/              # Next.js 16 (App Router, RSC, Suspense)
│   │   ├── src/app/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── discord-bot/      # discord.js v14 + tRPC client
│       ├── src/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── database/         # Drizzle schema, migrations, client
│   │   ├── src/
│   │   │   ├── schema.ts       # Drizzle table definitions
│   │   │   ├── relations.ts    # Drizzle relations
│   │   │   ├── migrate.ts      # Migration runner
│   │   │   └── client.ts       # DB client export
│   │   ├── drizzle/            # Generated SQL migrations
│   │   └── package.json
│   ├── bhapi/            # Brawlhalla API client + dual rate limiter
│   │   └── package.json
│   └── ui/               # Shadcn/Radix components
│       └── package.json
├── docker-compose.yml    # App services only (Postgres + Redis managed by Coolify)
├── bunfig.toml
└── package.json          # Workspace root
```

## Docker Compose (Apps Only)

Postgres and Redis are managed as separate Coolify resources.

```yaml
services:
  api:
    build: .
    command: bun run apps/api/src/serve.ts
    environment:
      - DATABASE_URL
      - REDIS_URL
      - BRAWLHALLA_API_KEY

  worker:
    build: .
    command: bun run apps/api/src/worker.ts
    environment:
      - DATABASE_URL
      - REDIS_URL
      - BRAWLHALLA_API_KEY

  web:
    build: ./apps/web
    command: bun run start
    environment:
      - API_URL=http://api:3000

  discord-bot:
    build: .
    command: bun run apps/discord-bot/src/index.ts
    environment:
      - DISCORD_TOKEN
      - DISCORD_CLIENT_ID
      - API_URL=http://api:3000
```

## Database Schema (Drizzle)

Same core models as v1 with these changes:

- **New: `ratingHistory`** — stores rating snapshots over time for rating graphs
- **New: `leaderboard1v1` / `leaderboard2v2`** — regular tables refreshed by worker (replacing on-the-fly queries)
- **Changed:** damage values stored as `bigint` instead of `string`
- **Changed:** `playerAlias` gets `createdAt` timestamp
- **Changed:** `player` gets `refreshTier` field (`hot` | `warm` | `cold`)
- **Removed:** `shared-types` lib (tRPC infers types)
- **Removed:** `shared-utils` lib (absorbed into relevant packages)

### Rating History Table

```typescript
export const ratingHistory = pgTable(
  'rating_history',
  {
    id: serial('id').primaryKey(),
    brawlhallaId: integer('brawlhalla_id').notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  },
  (t) => [index('idx_rating_history_player').on(t.brawlhallaId), index('idx_rating_history_time').on(t.brawlhallaId, t.recordedAt)],
);
```

## Refresh Strategy (Redesigned)

### Root Cause (v1)

Queue filled faster than it drained due to:

- Uncontrolled job creation from API discovery
- No backpressure
- Priority starvation (popular players monopolized queue)
- Janitor and refresh jobs competing for same API token budget
- Only respecting 180/15min limit, not 10/sec burst limit

### Token Budget System

```
Brawlhalla API: 180 calls/15min, 10 calls/sec burst

Budget split:
  On-demand refresh: 60% (108 tokens/15min)
  Janitor crawling:  30% (54 tokens/15min)
  Reserve buffer:    10% (18 tokens/15min)
```

### Tiered TTLs

```
Hot  (viewed in last 24h, or top 1000):  1hr ranked, 6hr stats
Warm (viewed in last 7 days):            6hr ranked, 24hr stats
Cold (no views in 7+ days):             never auto-refresh, on-demand only
```

Players get assigned a `refreshTier` on every view.

### Backpressure Rules

- Queue hard cap: 200 jobs. Beyond that, new discovery rejected.
- On-demand: if refreshed within TTL, serve stale data, don't queue.
- Dedup: `SET dedup:ranked:{id} EX {ttl} NX` — only 1 job per player per TTL window.
- Discovery: blocked when queue > 100 or token reserve < 20%.

### Rating History Capture

- Snapshot on every ranked refresh — zero extra API calls.
- Only insert if rating changed since last snapshot.

### Janitor Cycle (every minute)

1. Check token budget — skip if reserve depleted
2. Hot leaderboard pages (1v1 + 2v2, top 10) — every cycle
3. Cold leaderboard pages (11-200) — every 10 minutes
4. Regional leaderboards — rotate 1 region per cycle
5. Clan backfill — max 2 enqueues/cycle, only if queue < 50
6. Valhallan confirmation

## Queue Design (Bun-native Redis Streams)

Separate streams per job type:

```
queue:refresh-ranked    (concurrency: 5)
queue:refresh-stats     (concurrency: 3)
queue:refresh-clan      (concurrency: 2)
queue:dlq               (dead letter, manual inspection)
```

Each stream has its own consumer group and concurrency limit. Total concurrent: 10.

All API calls go through a single dual rate limiter in the bhapi client:

```typescript
const limiter = {
  burst: new TokenBucket({ capacity: 10, refillRate: 10, interval: 1000 }),
  sustained: new TokenBucket({ capacity: 180, refillRate: 180, interval: 15 * 60 * 1000 }),
};

async function callApi<T>(endpoint: string): Promise<T> {
  await limiter.burst.acquire();
  await limiter.sustained.acquire();
  return fetch(`https://api.brawlhalla.com${endpoint}&api_key=${key}`);
}
```

## tRPC Router Design

```
router.ts                 # Root router
player.router.ts          # player.byId, player.search
clan.router.ts            # clan.byId, clan.search
leaderboard.router.ts     # leaderboard.get (bracket, region, sort, page)
status.router.ts          # status.health (healthy | degraded | down)
```

- `player.byId` returns full profile (ranked, stats, legends, weapons, clan, rating history)
- Search returns blended player + clan results
- Leaderboard input validated with Zod
- No internal token counts exposed via status endpoint
- Discord bot consumes via tRPC client over HTTP

## Frontend Architecture

### Streaming Pattern

```tsx
// player/[id]/page.tsx (RSC)
export default async function PlayerPage({ params }) {
  const { id } = await params;
  return (
    <div>
      <Suspense fallback={<RankedSkeleton />}>
        <RankedSection id={id} />
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <RatingChart id={id} />
      </Suspense>
      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection id={id} />
      </Suspense>
      <Suspense fallback={<LegendsSkeleton />}>
        <LegendsSection id={id} />
      </Suspense>
      <Suspense fallback={<WeaponsSkeleton />}>
        <WeaponsSection id={id} />
      </Suspense>
    </div>
  );
}
```

Each section fetches independently via tRPC server caller.

### Key Components

- **Search bar** — client component, debounced tRPC query
- **Leaderboard** — client component, URL search params as source of truth
- **Rating chart** — new feature, renders rating over time from `ratingHistory`
- **Player profile** — RSC with Suspense boundaries per section
- **Clan profile** — RSC with paginated member roster

## Deployment

```
Cloudflare (DNS + proxy)
  ├── brawltome.app → Coolify (web)
  └── api.brawltome.app → Coolify (api)

Coolify (Hetzner VPS ~60 EUR/mo)
  ├── api        (bun run apps/api/src/serve.ts)
  ├── worker     (bun run apps/api/src/worker.ts)
  ├── web        (bun run apps/web/start)
  ├── discord-bot (bun run apps/discord-bot/src/index.ts)
  ├── postgres   (Coolify-managed resource)
  └── redis      (Coolify-managed resource)
```

- Cloudflare: SSL, DDoS, static asset caching, leaderboard page caching via Cache-Control headers
- Single Dockerfile (multi-stage) for api/worker/bot, separate Dockerfile for web
- Health check: `GET /health` → `{ status: "healthy" | "degraded" | "down" }`
- Coolify auto-deploys on push to master via GitHub webhook
- UptimeRobot for external monitoring

## Testing

```bash
bun test                    # All tests
bun test apps/api           # API tests only
bun test packages/database  # DB tests only
```

- Unit tests for business logic
- Integration tests for tRPC routers against real test Postgres
- No database mocking
- Test files co-located: `*.test.ts`

## CI/CD (GitHub Actions)

```yaml
steps:
  - uses: oven/setup-bun@v2
  - run: bun install --frozen-lockfile
  - run: bun run typecheck
  - run: bun run lint
  - run: bun run build
  - run: bun test
```
