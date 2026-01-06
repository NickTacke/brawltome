# CLAUDE.md

This file provides guidance for AI assistants working with the BrawlTome codebase.

## Project Overview

BrawlTome is a comprehensive Brawlhalla tracking application providing player statistics, rankings, clan information, and gameplay insights. It's built as an **Nx monorepo** using TypeScript throughout.

**Repository:** https://github.com/NickTacke/brawltome

## Tech Stack

- **Backend:** NestJS v11 with Express
- **Frontend:** Next.js v16 with React v19
- **Database:** PostgreSQL with Prisma ORM v7
- **Caching/Queues:** Redis with BullMQ
- **Styling:** Tailwind CSS v4 with Shadcn UI / Radix UI
- **Build System:** Nx monorepo
- **Package Manager:** pnpm
- **Testing:** Vitest with SWC
- **Discord Integration:** discord.js v14

## Project Structure

```
brawltome/
├── apps/
│   ├── api/           # NestJS REST API backend
│   ├── web/           # Next.js frontend (App Router)
│   ├── worker/        # BullMQ background job processor
│   └── discord-bot/   # Discord bot for player/clan lookups
├── libs/
│   ├── database/      # Prisma ORM, schema, and migrations
│   ├── bhapi-client/  # Brawlhalla API client wrapper
│   ├── shared-types/  # Shared TypeScript interfaces/DTOs
│   ├── shared-utils/  # Utility functions (weapon aggregation, rate limiting)
│   └── ui/            # Shared UI components (Shadcn/Radix)
├── docker-compose.yml # Local PostgreSQL and Redis
└── nx.json            # Nx configuration
```

## Path Aliases

Use these imports for shared libraries:

```typescript
import { PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PlayerDTO } from '@brawltome/shared-types';
import { createWeaponAggregator } from '@brawltome/shared-utils';
import { Button } from '@brawltome/ui';
```

## Common Commands

```bash
# Development servers
pnpm dev:api          # Start API on localhost:3000
pnpm dev:web          # Start frontend dev server
pnpm dev:worker       # Start background worker
pnpm dev:discord-bot  # Start Discord bot

# Build & Test
pnpm build            # Build all projects
pnpm test             # Run all tests (Vitest)
pnpm lint             # Lint all projects
pnpm typecheck        # Type-check all projects
pnpm format           # Format all files
pnpm format:check     # Verify formatting

# Database
pnpm seed:legends     # Seed static Legend data
pnpm seed:api         # Run general API seeder
pnpm prisma:validate  # Validate Prisma schema

# Discord bot
pnpm sync-emojis:discord-bot  # Sync Discord emojis

# Start local dependencies
docker compose up -d  # PostgreSQL + Redis
```

## Database Schema

The Prisma schema is located at `libs/database/prisma/schema.prisma`.

**Core models:**
- `Player` - Core player data with rating, tier, games, wins
- `PlayerStats` / `PlayerStatsLegend` - General stats per legend
- `PlayerRanked` / `PlayerRankedLegend` / `PlayerRankedTeam` - Ranked mode data
- `PlayerWeaponStat` - Aggregated weapon statistics
- `Legend` - Static legend data (weapons, stats, bio)
- `Clan` / `ClanMember` - Clan organization
- `DiscordLink` - Discord account linking
- `Blacklist` - Player filtering/hiding from leaderboards

**Important patterns:**
- All relations use `onDelete: Cascade`
- `brawlhallaId` is the primary key for player-related models
- Composite keys used for join tables (e.g., `@@id([brawlhallaId, legendId])`)
- Damage values stored as `String` due to large numbers from API

## Code Conventions

### TypeScript
- Strict mode enabled
- Use single quotes for strings (Prettier config)
- Path aliases for cross-library imports
- NestJS decorators for backend (`@Injectable()`, `@Controller()`, etc.)
- React functional components with hooks for frontend

### NestJS Services Pattern
```typescript
@Injectable()
export class ExampleService implements OnModuleInit {
  private readonly logger = new Logger(ExampleService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('queue-name') private queue: Queue,
  ) {}

  async onModuleInit() {
    // Initialize caches, etc.
  }
}
```

### Commit Messages
Uses conventional commits (enforced by commitlint):
```
feat: add new feature
fix: correct a bug
docs: update documentation
refactor: restructure code
test: add tests
chore: maintenance tasks
```

### File Naming
- Services: `*.service.ts`
- Controllers: `*.controller.ts`
- Modules: `*.module.ts`
- Tests: `*.spec.ts`
- React components: PascalCase `ComponentName.tsx`
- Utilities: kebab-case `utility-name.ts`

## Testing

Tests use Vitest with the pattern `**/*.spec.ts`:

```bash
pnpm test           # Run all tests
pnpm test -- --watch  # Watch mode (if needed)
```

Test files are co-located with source:
- `apps/api/src/search/search.utils.spec.ts`
- `libs/shared-utils/src/weapon-aggregation.spec.ts`
- `libs/bhapi-client/src/lib/bhapi-client.service.spec.ts`

## CI/CD Pipeline

GitHub Actions runs on push to `master` and all PRs:

1. Format check (`nx format:check --all`)
2. Lint (`nx run-many -t lint --all`)
3. Type check (`nx run-many -t typecheck --all`)
4. Build (`nx run-many -t build --all`)
5. Tests (`pnpm test`)
6. Prisma schema validation

**All checks must pass before merging.**

## Environment Variables

### API (`apps/api/.env`)
```
DATABASE_URL=postgresql://...
BRAWLHALLA_API_KEY=your-api-key
REDIS_URL=redis://localhost:6379
```

### Worker (`apps/worker/.env`)
```
DATABASE_URL=postgresql://...
BRAWLHALLA_API_KEY=your-api-key
REDIS_URL=redis://localhost:6379
```

### Web (`apps/web/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Discord Bot (`apps/discord-bot/.env`)
```
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
API_URL=http://localhost:3000
```

## Key Architectural Patterns

### Data Refresh Strategy
- Player data has TTLs (ranked: 1 hour, stats: 12 hours)
- Stale data triggers background refresh via BullMQ queue
- Priority calculated based on view count and data age

### Rate Limiting
- Brawlhalla API has rate limits
- Discovery of new players blocked when tokens low
- Uses shared utility: `@brawltome/shared-utils`

### Caching
- In-memory caches for legends, weapons, blacklist
- Caches refreshed on module initialization
- Redis for job queue persistence

### Module Boundaries
- Nx enforces module boundaries via ESLint
- Apps can depend on libs, not other apps
- Libs should be self-contained

## Common Tasks for AI Assistants

### Adding a New API Endpoint
1. Add route in `apps/api/src/[module]/[module].controller.ts`
2. Add business logic in `apps/api/src/[module]/[module].service.ts`
3. Add types to `libs/shared-types/src/` if needed
4. Run `pnpm lint && pnpm typecheck` to verify

### Adding a New Database Field
1. Update `libs/database/prisma/schema.prisma`
2. Run `npx prisma migrate dev --name description --schema libs/database/prisma/schema.prisma`
3. Regenerate Prisma client
4. Update relevant services and DTOs

### Adding a New Discord Command
1. Add command definition in `apps/discord-bot/src/`
2. Register command with `pnpm sync-emojis:discord-bot`
3. Handle command in bot event handlers

### Adding a New Shared Library
1. Use `nx g @nx/js:lib libs/new-lib`
2. Add path alias to `tsconfig.base.json`
3. Export from `libs/new-lib/src/index.ts`

## Troubleshooting

### Prisma Issues
```bash
# Regenerate client
npx prisma generate --schema libs/database/prisma/schema.prisma

# Reset database (caution: destroys data)
npx prisma migrate reset --schema libs/database/prisma/schema.prisma
```

### Build Cache Issues
```bash
# Clear Nx cache
npx nx reset
```

### Type Errors After Changes
```bash
# Full rebuild
pnpm build
pnpm typecheck
```
