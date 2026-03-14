# BrawlTome

Brawlhalla player tracking — stats, rankings, clans, and rating history.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Backend**: [Hono](https://hono.dev/) + [tRPC](https://trpc.io/)
- **Frontend**: [Next.js 16](https://nextjs.org/) (App Router, RSC)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Queue**: Redis Streams (Bun-native)
- **Discord**: [discord.js](https://discord.js.org/) v14
- **Styling**: Tailwind CSS + Shadcn UI
- **Linting**: [Biome](https://biomejs.dev/)

## Structure

```
apps/
  api/           # Hono + tRPC server (API + worker entrypoints)
  web/           # Next.js frontend
  discord-bot/   # Discord bot
packages/
  database/      # Drizzle schema, migrations, client
  bhapi/         # Brawlhalla API client + rate limiter
  ui/            # Shared UI components
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.2+
- PostgreSQL
- Redis
- Brawlhalla API key ([dev.brawlhalla.com](https://dev.brawlhalla.com/))

### Setup

```bash
git clone https://github.com/NickTacke/brawltome
cd brawltome
bun install
```

Start local postgres and redis:

```bash
docker compose up -d
```

Create `.env` files:

```bash
# apps/api/.env
DATABASE_URL=postgres://brawltome:brawltome@localhost:5432/brawltome
REDIS_URL=redis://localhost:6379
BRAWLHALLA_API_KEY=your-key

# apps/web/.env
NEXT_PUBLIC_API_URL=http://localhost:3000

# apps/discord-bot/.env
API_URL=http://localhost:3000
DISCORD_TOKEN=your-token
DISCORD_CLIENT_ID=your-client-id
```

### Development

```bash
bun run dev:api          # API server
bun run dev:worker       # Background worker
bun run dev:web          # Frontend
bun run dev:discord-bot  # Discord bot
```

### Database

```bash
bun run db:generate      # Generate migration from schema changes
bun run db:migrate       # Run migrations
bun run db:push          # Push schema directly (dev only)
```

### Commands

```bash
bun test                 # Run all tests
bun run typecheck        # Type-check all packages
bun run lint             # Lint (Biome)
bun run format           # Format (Biome)
```
