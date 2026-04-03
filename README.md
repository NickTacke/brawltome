<p align="center">
  <img src="apps/web/public/images/logo.png" alt="BrawlTome" width="400" />
</p>

<p align="center">Brawlhalla player tracking: stats, rankings, clans, and rating history.</p>

<p align="center">
  <a href="https://brawltome.app">Web App</a> · <a href="#discord-bot">Discord Bot</a> · <a href="#desktop-overlay">Desktop Overlay</a>
</p>

## Features

- **Player Profiles**: ranked stats, legend breakdowns, weapon usage, rating history charts
- **Global Leaderboards**: 1v1 and 2v2 rankings across all regions with sorting and pagination
- **Clan Pages**: member lists with ratings, XP tracking, rank info
- **Name History**: tracks player name changes as searchable aliases
- **Discord Bot**: `/player`, `/clan`, `/status` slash commands with rich embeds
- **Desktop Overlay**: Tauri app that detects in-game opponents via memory scanning and displays stats in real-time
- **Background Sync**: Janitor service keeps top rankings fresh, discovers new players, and confirms Valhallan tiers

## Architecture

```
┌─────────────────────────────────────────────────┐
│              CLIENT LAYER                       │
│   Web (Next.js)  │  Desktop (Tauri)  │  Discord │
└────────┬──────────────────┬──────────┬──────────┘
         │  tRPC + SuperJSON│          │
         ▼                  ▼          ▼
┌─────────────────────────────────────────────────┐
│          API SERVER (Hono + tRPC)               │
└──┬──────────┬──────────┬────────────────────────┘
   │          │          │
   ▼          ▼          ▼
PostgreSQL   Redis    Brawlhalla API
   ▲       (Streams)
   │          │
   │          ▼
   │    ┌───────────────┐
   └────│    WORKER      │
        │  Queue consumers│
        │  Janitor service│
        └───────────────┘
```

- **API Server** enqueues jobs with concurrency 0 (no consumers)
- **Worker Process** runs queue consumers and the Janitor
- **Redis Streams** with priority lanes, deduplication, and dead letter queue
- **Tiered TTL**: hot/warm/cold refresh strategy balances freshness vs API rate limits

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh/) 1.2+ |
| Backend | [Hono](https://hono.dev/) + [tRPC](https://trpc.io/) 11 |
| Frontend | [Next.js](https://nextjs.org/) 16 (App Router, RSC) |
| Desktop | [Tauri](https://tauri.app/) 2 (Rust + React) |
| Discord | [discord.js](https://discord.js.org/) v14 |
| Database | PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team/) |
| Queue | Redis 7 Streams |
| Styling | Tailwind CSS 4 + Shadcn UI (Radix) |
| Linting | [Biome](https://biomejs.dev/) |

## Structure

```
apps/
  api/              # Hono + tRPC server and worker entrypoints
  web/              # Next.js frontend
  desktop/          # Tauri desktop overlay
  discord-bot/      # Discord bot
packages/
  database/         # Drizzle schema, migrations, client
  bhapi/            # Brawlhalla API client + rate limiter
  shared/           # Shared constants (TTLs, thresholds)
  ui/               # Shared UI components (Radix + Tailwind)
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.2+
- [Docker](https://www.docker.com/) (for PostgreSQL + Redis)
- Brawlhalla API key ([dev.brawlhalla.com](https://dev.brawlhalla.com/))

### Setup

```bash
git clone https://github.com/NickTacke/brawltome
cd brawltome
bun install
docker compose up -d
```

Copy `.env.example` and fill in your values:

```bash
# apps/api/.env
DATABASE_URL=postgres://brawltome:brawltome@localhost:5432/brawltome
REDIS_URL=redis://localhost:6379
BRAWLHALLA_API_KEY=your-key
INTERNAL_API_SECRET=<openssl rand -hex 32>

# apps/web/.env
NEXT_PUBLIC_API_URL=http://localhost:3000
INTERNAL_API_SECRET=<same as above>

# apps/discord-bot/.env (optional)
API_URL=http://localhost:3000
DISCORD_TOKEN=your-token
DISCORD_CLIENT_ID=your-client-id
INTERNAL_API_SECRET=<same as above>
```

Initialize the database:

```bash
bun run db:generate
bun run db:migrate
```

### Development

```bash
bun run dev:api          # API server (localhost:3000)
bun run dev:worker       # Background worker (queue consumers + janitor)
bun run dev:web          # Frontend (localhost:3001)
bun run dev:discord-bot  # Discord bot
bun run dev:desktop      # Desktop overlay (Tauri)
```

### Commands

```bash
bun test                 # Run all tests
bun run typecheck        # Type-check all packages
bun run lint             # Lint (Biome)
bun run format           # Format (Biome)
bun run db:generate      # Generate migration from schema changes
bun run db:migrate       # Run migrations
bun run db:push          # Push schema directly (dev only)
```

## Deployment

The Dockerfile provides multi-stage builds with three targets:

```bash
docker build --target api -t brawltome-api .
docker build --target worker -t brawltome-worker .
docker build --target discord-bot -t brawltome-discord-bot .
```

Multiple worker instances can run simultaneously. The Janitor uses a Redis distributed lock to ensure only one instance syncs rankings.

## Discord Bot

Slash commands:

| Command | Description |
|---|---|
| `/player <name>` | Search and display player stats |
| `/clan <name>` | Search and display clan info |
| `/status` | API health check |

## Desktop Overlay

The Tauri app scans game memory to detect opponents and displays their stats as an always-on-top overlay during matches. Requires the desktop app to be built separately via `bun run dev:desktop`.
