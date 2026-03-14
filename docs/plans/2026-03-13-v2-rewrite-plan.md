# BrawlTome v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite BrawlTome from scratch using Bun/Hono/tRPC/Drizzle, fixing the queue backlog issue and adding rating history.

**Architecture:** Bun monorepo with workspaces. Hono + tRPC for the API, Drizzle ORM, Bun-native Redis Streams queue, Next.js 16 with RSC streaming, discord.js bot. Deployed on Coolify (Hetzner) with Cloudflare.

**Tech Stack:** Bun, Hono, tRPC, Drizzle, Redis Streams, Next.js 16, discord.js v14, Tailwind + Shadcn

**Design Doc:** `docs/plans/2026-03-13-v2-rewrite-design.md`

---

## Phase 1: Monorepo Scaffold

Set up the empty project structure with all packages wired together. Nothing runs yet — just the skeleton.

### Task 1.1: Initialize Bun workspace root

Create a fresh branch for the rewrite. Set up the root `package.json` with Bun workspaces pointing at `apps/*` and `packages/*`.

**Files:**

- Create: `package.json`
- Create: `bunfig.toml`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Steps:**

1. Create a new branch:

```bash
git checkout -b v2-rewrite
```

2. Remove all existing source files (keep `docs/`, `.github/`):

```bash
# Be careful here — review what you're deleting
rm -rf apps/ libs/ nx.json pnpm-lock.yaml vitest.config.ts
rm -rf commitlint.config.ts eslint.config.mjs tsconfig.base.json tsconfig.json
```

3. Create root `package.json`:

```json
{
  "name": "brawltome",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:api": "bun run --filter @brawltome/api dev",
    "dev:web": "bun run --filter @brawltome/web dev",
    "dev:worker": "bun run --filter @brawltome/api dev:worker",
    "dev:discord-bot": "bun run --filter @brawltome/discord-bot dev",
    "build": "bun run --filter '*' build",
    "test": "bun test",
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "bun run --filter '*' lint",
    "db:generate": "bun run --filter @brawltome/database generate",
    "db:migrate": "bun run --filter @brawltome/database migrate",
    "db:push": "bun run --filter @brawltome/database push"
  }
}
```

4. Create `bunfig.toml`:

```toml
[install]
peer = false
```

5. Create root `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "paths": {
      "@brawltome/database": ["./packages/database/src/index.ts"],
      "@brawltome/bhapi": ["./packages/bhapi/src/index.ts"],
      "@brawltome/ui": ["./packages/ui/src/index.ts"],
      "@brawltome/ui/*": ["./packages/ui/src/*"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

6. Create `.gitignore` (or update existing):

```
node_modules/
dist/
.env
.env.*
!.env.example
bun.lock
*.tsbuildinfo
.next/
drizzle/meta/
```

7. Commit:

```bash
git add -A
git commit -m "chore: initialize bun workspace root for v2 rewrite"
```

---

### Task 1.2: Scaffold all package directories

Create the directory structure and `package.json` for every app and package. No source code yet — just the wiring.

**Files:**

- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/index.ts` (empty export)
- Create: `packages/bhapi/package.json`
- Create: `packages/bhapi/tsconfig.json`
- Create: `packages/bhapi/src/index.ts` (empty export)
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts` (empty export)
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/serve.ts` (hello world)
- Create: `apps/api/src/worker.ts` (hello world)
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/discord-bot/package.json`
- Create: `apps/discord-bot/tsconfig.json`
- Create: `apps/discord-bot/src/index.ts` (hello world)

**Steps:**

1. Create all directories:

```bash
mkdir -p packages/{database,bhapi,ui}/src
mkdir -p apps/{api,web,discord-bot}/src
```

2. Each `package.json` follows this pattern (adjust name/deps per package):

`packages/database/package.json`:

```json
{
  "name": "@brawltome/database",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "push": "drizzle-kit push",
    "studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/bhapi/package.json`:

```json
{
  "name": "@brawltome/bhapi",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

`packages/ui/package.json`:

```json
{
  "name": "@brawltome/ui",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-select": "^2.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

`apps/api/package.json`:

```json
{
  "name": "@brawltome/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/serve.ts",
    "dev:worker": "bun run --hot src/worker.ts",
    "build": "bun build src/serve.ts --outdir dist --target bun",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brawltome/database": "workspace:*",
    "@brawltome/bhapi": "workspace:*",
    "@trpc/server": "^11.0.0",
    "@hono/trpc-server": "^0.3.0",
    "hono": "^4.7.0",
    "ioredis": "^5.8.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0"
  }
}
```

`apps/web/package.json`:

```json
{
  "name": "@brawltome/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brawltome/ui": "workspace:*",
    "@trpc/client": "^11.0.0",
    "@trpc/react-query": "^11.0.0",
    "@tanstack/react-query": "^5.62.0",
    "next": "^16.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "next-themes": "^0.4.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/discord-bot/package.json`:

```json
{
  "name": "@brawltome/discord-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@trpc/client": "^11.0.0",
    "discord.js": "^14.22.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0"
  }
}
```

3. Create placeholder `tsconfig.json` in each package/app that extends root:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

4. Create placeholder source files:

`packages/database/src/index.ts`:

```typescript
export {};
```

`packages/bhapi/src/index.ts`:

```typescript
export {};
```

`packages/ui/src/index.ts`:

```typescript
export {};
```

`apps/api/src/serve.ts`:

```typescript
console.log('API server placeholder');
```

`apps/api/src/worker.ts`:

```typescript
console.log('Worker placeholder');
```

`apps/discord-bot/src/index.ts`:

```typescript
console.log('Discord bot placeholder');
```

5. Install all dependencies:

```bash
bun install
```

6. Verify the workspace is wired:

```bash
bun run typecheck
```

7. Commit:

```bash
git add -A
git commit -m "chore: scaffold all packages and apps"
```

---

## Phase 2: Database Package

Translate the Prisma schema to Drizzle, add the new tables (ratingHistory, leaderboard tables), and set up migrations.

### Task 2.1: Define core Drizzle schema

Translate every Prisma model to Drizzle table definitions. This is the biggest single file in the rewrite. Take your time — every field matters.

**Files:**

- Create: `packages/database/src/schema.ts`
- Create: `packages/database/src/relations.ts`

**Why this structure:** Drizzle recommends separating table definitions from relations to avoid circular imports. Schema defines columns/indexes, relations defines how tables connect.

**Steps:**

1. Create `packages/database/src/schema.ts`:

```typescript
import { pgTable, integer, varchar, text, timestamp, real, bigint, serial, index, uniqueIndex, primaryKey, pgEnum } from 'drizzle-orm/pg-core';

// Enums
export const refreshTierEnum = pgEnum('refresh_tier', ['hot', 'warm', 'cold']);

// ============================================================
// Player
// ============================================================

export const player = pgTable(
  'player',
  {
    brawlhallaId: integer('brawlhalla_id').primaryKey(),
    name: varchar('name', { length: 256 }).notNull(),
    region: varchar('region', { length: 16 }),

    // Ranked stats
    rating: integer('rating').default(0).notNull(),
    peakRating: integer('peak_rating').default(0),
    tier: varchar('tier', { length: 64 }),
    valhallanConfirmedAt: timestamp('valhallan_confirmed_at'),
    games: integer('games').default(0).notNull(),
    wins: integer('wins').default(0).notNull(),

    // Best legend
    bestLegend: integer('best_legend').default(0),
    bestLegendGames: integer('best_legend_games').default(0),
    bestLegendWins: integer('best_legend_wins').default(0),

    // Metadata
    lastUpdated: timestamp('last_updated').defaultNow().notNull(),
    viewCount: integer('view_count').default(0).notNull(),
    lastViewedAt: timestamp('last_viewed_at').defaultNow().notNull(),
    refreshTier: refreshTierEnum('refresh_tier').default('cold').notNull(),
  },
  (t) => [
    // Search
    index('idx_player_name').on(t.name),
    index('idx_player_view_count').on(t.viewCount),

    // Global leaderboard sorts
    index('idx_player_rating').on(t.rating),
    index('idx_player_peak_rating').on(t.peakRating),
    index('idx_player_wins').on(t.wins),
    index('idx_player_games').on(t.games),

    // Regional leaderboard sorts
    index('idx_player_region_rating').on(t.region, t.rating),
    index('idx_player_region_peak_rating').on(t.region, t.peakRating),
    index('idx_player_region_wins').on(t.region, t.wins),
    index('idx_player_region_games').on(t.region, t.games),
  ],
);

// ============================================================
// Player Alias
// ============================================================

export const playerAlias = pgTable(
  'player_alias',
  {
    brawlhallaId: integer('brawlhalla_id').notNull(),
    key: varchar('key', { length: 256 }).notNull(),
    value: varchar('value', { length: 256 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.key] }), index('idx_alias_key').on(t.key)],
);

// ============================================================
// Player Stats
// ============================================================

export const playerStats = pgTable('player_stats', {
  brawlhallaId: integer('brawlhalla_id').primaryKey(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),

  // Account stats
  xp: integer('xp').notNull(),
  level: integer('level').notNull(),
  xpPercentage: real('xp_percentage').notNull(),
  games: integer('games').notNull(),
  wins: integer('wins').notNull(),
  matchTimeTotal: integer('match_time_total').default(0).notNull(),

  // Gadget damage (bigint instead of string)
  damageBomb: bigint('damage_bomb', { mode: 'bigint' }).notNull(),
  damageMine: bigint('damage_mine', { mode: 'bigint' }).notNull(),
  damageSpikeball: bigint('damage_spikeball', { mode: 'bigint' }).notNull(),
  damageSidekick: bigint('damage_sidekick', { mode: 'bigint' }).notNull(),

  // Gadget hits / kills
  hitSnowball: integer('hit_snowball').notNull(),
  koBomb: integer('ko_bomb').notNull(),
  koMine: integer('ko_mine').notNull(),
  koSpikeball: integer('ko_spikeball').notNull(),
  koSidekick: integer('ko_sidekick').notNull(),
  koSnowball: integer('ko_snowball').notNull(),
});

// ============================================================
// Player Stats Legend
// ============================================================

export const playerStatsLegend = pgTable(
  'player_stats_legend',
  {
    brawlhallaId: integer('brawlhalla_id').notNull(),
    legendId: integer('legend_id').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),

    // XP
    xp: integer('xp').notNull(),
    level: integer('level').notNull(),
    xpPercentage: real('xp_percentage').notNull(),

    // General
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    matchTime: integer('match_time').notNull(),
    kos: integer('kos').notNull(),
    teamKos: integer('team_kos').notNull(),
    suicides: integer('suicides').notNull(),
    falls: integer('falls').notNull(),
    damageDealt: bigint('damage_dealt', { mode: 'bigint' }).notNull(),
    damageTaken: bigint('damage_taken', { mode: 'bigint' }).notNull(),

    // Weapon damage/KOs
    damageWeaponOne: bigint('damage_weapon_one', { mode: 'bigint' }).notNull(),
    damageWeaponTwo: bigint('damage_weapon_two', { mode: 'bigint' }).notNull(),
    timeHeldWeaponOne: integer('time_held_weapon_one').notNull(),
    timeHeldWeaponTwo: integer('time_held_weapon_two').notNull(),
    koWeaponOne: integer('ko_weapon_one').notNull(),
    koWeaponTwo: integer('ko_weapon_two').notNull(),

    // Specific
    koUnarmed: integer('ko_unarmed').notNull(),
    koThrownItem: integer('ko_thrown_item').notNull(),
    koGadgets: integer('ko_gadgets').notNull(),
    damageUnarmed: bigint('damage_unarmed', { mode: 'bigint' }).notNull(),
    damageThrownItem: bigint('damage_thrown_item', { mode: 'bigint' }).notNull(),
    damageGadgets: bigint('damage_gadgets', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.legendId] })],
);

// ============================================================
// Player Clan (from stats endpoint)
// ============================================================

export const playerClan = pgTable('player_clan', {
  brawlhallaId: integer('brawlhalla_id').primaryKey(),
  clanName: varchar('clan_name', { length: 256 }).notNull(),
  clanId: integer('clan_id').notNull(),
  clanXp: bigint('clan_xp', { mode: 'bigint' }).notNull(),
  clanLifetimeXp: integer('clan_lifetime_xp').notNull(),
  personalXp: integer('personal_xp').notNull(),
});

// ============================================================
// Player Weapon Stat (aggregated across legends)
// ============================================================

export const playerWeaponStat = pgTable(
  'player_weapon_stat',
  {
    brawlhallaId: integer('brawlhalla_id').notNull(),
    weapon: varchar('weapon', { length: 64 }).notNull(),
    timeHeld: integer('time_held').notNull(),
    damage: bigint('damage', { mode: 'bigint' }).notNull(),
    kos: integer('kos').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.weapon] })],
);

// ============================================================
// Player Ranked
// ============================================================

export const playerRanked = pgTable('player_ranked', {
  brawlhallaId: integer('brawlhalla_id').primaryKey(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
});

export const playerRankedLegend = pgTable(
  'player_ranked_legend',
  {
    brawlhallaId: integer('brawlhalla_id').notNull(),
    legendId: integer('legend_id').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }).notNull(),
    wins: integer('wins').notNull(),
    games: integer('games').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brawlhallaId, t.legendId] })],
);

export const playerRankedTeam = pgTable(
  'player_ranked_team',
  {
    brawlhallaId: integer('brawlhalla_id').notNull(),
    brawlhallaIdOne: integer('brawlhalla_id_one').notNull(),
    brawlhallaIdTwo: integer('brawlhalla_id_two').notNull(),
    teamName: varchar('team_name', { length: 256 }).notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }).notNull(),
    wins: integer('wins').notNull(),
    games: integer('games').notNull(),
    region: varchar('region', { length: 16 }),
    globalRank: integer('global_rank'),
  },
  (t) => [
    primaryKey({
      columns: [t.brawlhallaId, t.brawlhallaIdOne, t.brawlhallaIdTwo],
    }),
  ],
);

// ============================================================
// 2v2 Leaderboard Team
// ============================================================

export const ranked2v2Team = pgTable(
  'ranked_2v2_team',
  {
    region: varchar('region', { length: 16 }).notNull(),
    brawlhallaIdOne: integer('brawlhalla_id_one').notNull(),
    brawlhallaIdTwo: integer('brawlhalla_id_two').notNull(),
    rank: integer('rank').notNull(),
    teamName: varchar('team_name', { length: 256 }).notNull(),
    rating: integer('rating').notNull(),
    peakRating: integer('peak_rating').notNull(),
    tier: varchar('tier', { length: 64 }).notNull(),
    wins: integer('wins').notNull(),
    games: integer('games').notNull(),
    lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.region, t.brawlhallaIdOne, t.brawlhallaIdTwo] }), index('idx_2v2_region_rating').on(t.region, t.rating), index('idx_2v2_region_peak').on(t.region, t.peakRating), index('idx_2v2_region_wins').on(t.region, t.wins), index('idx_2v2_region_games').on(t.region, t.games), index('idx_2v2_region_rank').on(t.region, t.rank)],
);

// ============================================================
// Legend (static data)
// ============================================================

export const legend = pgTable('legend', {
  legendId: integer('legend_id').primaryKey(),
  legendNameKey: varchar('legend_name_key', { length: 64 }).notNull(),
  bioName: varchar('bio_name', { length: 128 }).notNull(),
  bioAka: varchar('bio_aka', { length: 256 }),
  bioQuote: text('bio_quote'),
  bioQuoteAboutAttrib: varchar('bio_quote_about_attrib', { length: 256 }).notNull(),
  bioQuoteFrom: text('bio_quote_from'),
  bioQuoteFromAttrib: varchar('bio_quote_from_attrib', { length: 256 }),
  bioText: text('bio_text'),
  botName: varchar('bot_name', { length: 128 }),
  weaponOne: varchar('weapon_one', { length: 64 }).notNull(),
  weaponTwo: varchar('weapon_two', { length: 64 }).notNull(),
  strength: varchar('strength', { length: 8 }).notNull(),
  dexterity: varchar('dexterity', { length: 8 }).notNull(),
  defense: varchar('defense', { length: 8 }).notNull(),
  speed: varchar('speed', { length: 8 }).notNull(),
});

// ============================================================
// Clan
// ============================================================

export const clan = pgTable('clan', {
  clanId: integer('clan_id').primaryKey(),
  clanName: varchar('clan_name', { length: 256 }).notNull(),
  clanCreateDate: timestamp('clan_create_date').notNull(),
  clanXp: bigint('clan_xp', { mode: 'bigint' }).notNull(),
  clanLifetimeXp: integer('clan_lifetime_xp').notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
});

export const clanMember = pgTable(
  'clan_member',
  {
    clanId: integer('clan_id').notNull(),
    brawlhallaId: integer('brawlhalla_id').notNull(),
    name: varchar('name', { length: 256 }).notNull(),
    rank: varchar('rank', { length: 64 }).notNull(),
    joinDate: timestamp('join_date').notNull(),
    xp: integer('xp').notNull(),
    legendNameKey: varchar('legend_name_key', { length: 64 }),
  },
  (t) => [primaryKey({ columns: [t.clanId, t.brawlhallaId] })],
);

// ============================================================
// Discord Link
// ============================================================

export const discordLink = pgTable('discord_link', {
  discordId: varchar('discord_id', { length: 64 }).primaryKey(),
  brawlhallaId: integer('brawlhalla_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================
// Blacklist
// ============================================================

export const blacklist = pgTable('blacklist', {
  brawlhallaId: integer('brawlhalla_id').primaryKey(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// Rating History (NEW)
// ============================================================

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

2. Create `packages/database/src/relations.ts`:

```typescript
import { relations } from 'drizzle-orm';
import { player, playerAlias, playerStats, playerStatsLegend, playerClan, playerWeaponStat, playerRanked, playerRankedLegend, playerRankedTeam, clan, clanMember, discordLink, ratingHistory } from './schema';

export const playerRelations = relations(player, ({ one, many }) => ({
  aliases: many(playerAlias),
  stats: one(playerStats, {
    fields: [player.brawlhallaId],
    references: [playerStats.brawlhallaId],
  }),
  ranked: one(playerRanked, {
    fields: [player.brawlhallaId],
    references: [playerRanked.brawlhallaId],
  }),
  discordLink: one(discordLink, {
    fields: [player.brawlhallaId],
    references: [discordLink.brawlhallaId],
  }),
  ratingHistory: many(ratingHistory),
}));

export const playerAliasRelations = relations(playerAlias, ({ one }) => ({
  player: one(player, {
    fields: [playerAlias.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}));

export const playerStatsRelations = relations(playerStats, ({ one, many }) => ({
  player: one(player, {
    fields: [playerStats.brawlhallaId],
    references: [player.brawlhallaId],
  }),
  legends: many(playerStatsLegend),
  weaponStats: many(playerWeaponStat),
  clan: one(playerClan, {
    fields: [playerStats.brawlhallaId],
    references: [playerClan.brawlhallaId],
  }),
}));

export const playerStatsLegendRelations = relations(playerStatsLegend, ({ one }) => ({
  stats: one(playerStats, {
    fields: [playerStatsLegend.brawlhallaId],
    references: [playerStats.brawlhallaId],
  }),
}));

export const playerClanRelations = relations(playerClan, ({ one }) => ({
  stats: one(playerStats, {
    fields: [playerClan.brawlhallaId],
    references: [playerStats.brawlhallaId],
  }),
}));

export const playerWeaponStatRelations = relations(playerWeaponStat, ({ one }) => ({
  stats: one(playerStats, {
    fields: [playerWeaponStat.brawlhallaId],
    references: [playerStats.brawlhallaId],
  }),
}));

export const playerRankedRelations = relations(playerRanked, ({ one, many }) => ({
  player: one(player, {
    fields: [playerRanked.brawlhallaId],
    references: [player.brawlhallaId],
  }),
  legends: many(playerRankedLegend),
  teams: many(playerRankedTeam),
}));

export const playerRankedLegendRelations = relations(playerRankedLegend, ({ one }) => ({
  ranked: one(playerRanked, {
    fields: [playerRankedLegend.brawlhallaId],
    references: [playerRanked.brawlhallaId],
  }),
}));

export const playerRankedTeamRelations = relations(playerRankedTeam, ({ one }) => ({
  ranked: one(playerRanked, {
    fields: [playerRankedTeam.brawlhallaId],
    references: [playerRanked.brawlhallaId],
  }),
}));

export const clanRelations = relations(clan, ({ many }) => ({
  members: many(clanMember),
}));

export const clanMemberRelations = relations(clanMember, ({ one }) => ({
  clan: one(clan, {
    fields: [clanMember.clanId],
    references: [clan.clanId],
  }),
}));

export const discordLinkRelations = relations(discordLink, ({ one }) => ({
  player: one(player, {
    fields: [discordLink.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}));

export const ratingHistoryRelations = relations(ratingHistory, ({ one }) => ({
  player: one(player, {
    fields: [ratingHistory.brawlhallaId],
    references: [player.brawlhallaId],
  }),
}));
```

3. Commit:

```bash
git add packages/database/src/schema.ts packages/database/src/relations.ts
git commit -m "feat(database): define drizzle schema with all models and relations"
```

---

### Task 2.2: Set up Drizzle client and config

Wire up the database client export and Drizzle Kit config so migrations work.

**Files:**

- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/drizzle.config.ts`

**Steps:**

1. Create `packages/database/src/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as relations from './relations';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const client = postgres(connectionString);

export const db = drizzle(client, {
  schema: { ...schema, ...relations },
});

export type Database = typeof db;
```

2. Update `packages/database/src/index.ts`:

```typescript
export { db, type Database } from './client';
export * from './schema';
export * from './relations';
```

3. Create `packages/database/drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

4. Generate the initial migration (requires a running Postgres):

```bash
cd packages/database
DATABASE_URL="postgresql://..." bunx drizzle-kit generate
```

5. Commit:

```bash
git add packages/database/
git commit -m "feat(database): add drizzle client, config, and initial migration"
```

---

## Phase 3: Brawlhalla API Client

### Task 3.1: Dual rate limiter

The core rate limiter that enforces both the 10/sec burst limit and 180/15min sustained limit.

**Files:**

- Create: `packages/bhapi/src/rate-limiter.ts`
- Create: `packages/bhapi/src/rate-limiter.test.ts`

**Steps:**

1. Write the test first (`packages/bhapi/src/rate-limiter.test.ts`):

```typescript
import { describe, it, expect } from 'bun:test';
import { TokenBucket } from './rate-limiter';

describe('TokenBucket', () => {
  it('allows requests within capacity', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, intervalMs: 1000 });
    for (let i = 0; i < 5; i++) {
      const waited = await bucket.acquire();
      expect(waited).toBe(0);
    }
  });

  it('blocks when tokens exhausted', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 2, intervalMs: 100 });
    await bucket.acquire();
    await bucket.acquire();
    const start = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // ~100ms refill
  });

  it('reports remaining tokens', async () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 10, intervalMs: 1000 });
    expect(bucket.remaining).toBe(10);
    await bucket.acquire();
    expect(bucket.remaining).toBe(9);
  });
});
```

2. Run to verify it fails:

```bash
bun test packages/bhapi/src/rate-limiter.test.ts
```

3. Implement `packages/bhapi/src/rate-limiter.ts`:

```typescript
export interface TokenBucketOptions {
  capacity: number;
  refillRate: number; // tokens added per interval
  intervalMs: number; // refill interval in ms
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly intervalMs: number;
  private lastRefill: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillRate = opts.refillRate;
    this.intervalMs = opts.intervalMs;
    this.tokens = opts.capacity;
    this.lastRefill = Date.now();
  }

  get remaining(): number {
    this.refill();
    return this.tokens;
  }

  async acquire(): Promise<number> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }

    // Calculate wait time until next token
    const timeSinceRefill = Date.now() - this.lastRefill;
    const timeUntilRefill = this.intervalMs - timeSinceRefill;
    const waitMs = Math.max(0, timeUntilRefill);

    await Bun.sleep(waitMs);
    this.refill();
    this.tokens -= 1;
    return waitMs;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.intervalMs) {
      const intervals = Math.floor(elapsed / this.intervalMs);
      this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillRate);
      this.lastRefill += intervals * this.intervalMs;
    }
  }
}
```

4. Run tests:

```bash
bun test packages/bhapi/src/rate-limiter.test.ts
```

5. Commit:

```bash
git add packages/bhapi/src/rate-limiter.ts packages/bhapi/src/rate-limiter.test.ts
git commit -m "feat(bhapi): add token bucket rate limiter with tests"
```

---

### Task 3.2: API client with typed endpoints

Wrap all 7 Brawlhalla API endpoints with TypeScript types and the dual rate limiter.

**Files:**

- Create: `packages/bhapi/src/types.ts`
- Create: `packages/bhapi/src/client.ts`
- Create: `packages/bhapi/src/index.ts`

**Steps:**

1. Create `packages/bhapi/src/types.ts` — types matching the API responses exactly:

```typescript
// GET /search?steamid=
export interface BhApiSearchResult {
  brawlhalla_id: number;
  name: string;
}

// GET /rankings/{bracket}/{region}/{page}
export interface BhApiRanking {
  rank: string;
  name: string;
  brawlhalla_id: number;
  best_legend: number;
  best_legend_games: number;
  best_legend_wins: number;
  rating: number;
  tier: string;
  games: number;
  wins: number;
  region: string;
  peak_rating: number;
}

// GET /player/{id}/stats
export interface BhApiPlayerStats {
  brawlhalla_id: number;
  name: string;
  xp: number;
  level: number;
  xp_percentage: number;
  games: number;
  wins: number;
  damagebomb: string;
  damagemine: string;
  damagespikeball: string;
  damagesidekick: string;
  hitsnowball: number;
  kobomb: number;
  komine: number;
  kospikeball: number;
  kosidekick: number;
  kosnowball: number;
  legends: BhApiStatsLegend[];
  clan?: BhApiPlayerClan;
}

export interface BhApiStatsLegend {
  legend_id: number;
  legend_name_key: string;
  damagedealt: string;
  damagetaken: string;
  kos: number;
  falls: number;
  suicides: number;
  teamkos: number;
  matchtime: number;
  games: number;
  wins: number;
  damageunarmed: string;
  damagethrownitem: string;
  damageweaponone: string;
  damageweapontwo: string;
  damagegadgets: string;
  kounarmed: number;
  kothrownitem: number;
  koweaponone: number;
  koweapontwo: number;
  kogadgets: number;
  timeheldweaponone: number;
  timeheldweapontwo: number;
  xp: number;
  level: number;
  xp_percentage: number;
}

export interface BhApiPlayerClan {
  clan_name: string;
  clan_id: number;
  clan_xp: string;
  clan_lifetime_xp: number;
  personal_xp: number;
}

// GET /player/{id}/ranked
export interface BhApiPlayerRanked {
  name: string;
  brawlhalla_id: number;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
  region: string;
  global_rank: number;
  region_rank: number;
  legends: BhApiRankedLegend[];
  '2v2': BhApiRankedTeam[];
}

export interface BhApiRankedLegend {
  legend_id: number;
  legend_name_key: string;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
}

export interface BhApiRankedTeam {
  brawlhalla_id_one: number;
  brawlhalla_id_two: number;
  rating: number;
  peak_rating: number;
  tier: string;
  wins: number;
  games: number;
  teamname: string;
  region: number;
  global_rank: number;
}

// GET /clan/{id}
export interface BhApiClan {
  clan_id: number;
  clan_name: string;
  clan_create_date: number;
  clan_xp: string;
  clan_lifetime_xp: number;
  clan: BhApiClanMember[];
}

export interface BhApiClanMember {
  brawlhalla_id: number;
  name: string;
  rank: string;
  join_date: number;
  xp: number;
}

// GET /legend/all
export interface BhApiLegend {
  legend_id: number;
  legend_name_key: string;
  bio_name: string;
  bio_aka: string;
  weapon_one: string;
  weapon_two: string;
  strength: string;
  dexterity: string;
  defense: string;
  speed: string;
}

// GET /legend/{id} (extended)
export interface BhApiLegendFull extends BhApiLegend {
  bio_quote: string;
  bio_quote_about_attrib: string;
  bio_quote_from: string;
  bio_quote_from_attrib: string;
  bio_text: string;
  bot_name: string;
}

// Bracket types
export type Bracket = '1v1' | '2v2' | 'kungfoot' | 'rotating';
export type Region = 'us-e' | 'eu' | 'sea' | 'brz' | 'aus' | 'us-w' | 'jpn' | 'me' | 'sa' | 'all';
```

2. Create `packages/bhapi/src/client.ts`:

```typescript
import { TokenBucket } from './rate-limiter';
import type { BhApiSearchResult, BhApiRanking, BhApiPlayerStats, BhApiPlayerRanked, BhApiClan, BhApiLegend, BhApiLegendFull, Bracket, Region } from './types';

const BASE_URL = 'https://api.brawlhalla.com';

export interface BhApiClientOptions {
  apiKey: string;
}

export class BhApiClient {
  private readonly apiKey: string;
  private readonly burst: TokenBucket;
  private readonly sustained: TokenBucket;

  constructor(opts: BhApiClientOptions) {
    this.apiKey = opts.apiKey;
    this.burst = new TokenBucket({ capacity: 10, refillRate: 10, intervalMs: 1000 });
    this.sustained = new TokenBucket({ capacity: 180, refillRate: 180, intervalMs: 15 * 60 * 1000 });
  }

  get remainingTokens(): number {
    return this.sustained.remaining;
  }

  // GET /search?steamid=
  async searchBySteamId(steamId: string): Promise<BhApiSearchResult | null> {
    return this.call(`/search?steamid=${steamId}`);
  }

  // GET /rankings/{bracket}/{region}/{page}
  async getRankings(bracket: Bracket, region: Region, page: number): Promise<BhApiRanking[]> {
    return this.call<BhApiRanking[]>(`/rankings/${bracket}/${region}/${page}`) ?? [];
  }

  // GET /player/{id}/stats
  async getPlayerStats(id: number): Promise<BhApiPlayerStats | null> {
    return this.call(`/player/${id}/stats`);
  }

  // GET /player/{id}/ranked
  async getPlayerRanked(id: number): Promise<BhApiPlayerRanked | null> {
    return this.call(`/player/${id}/ranked`);
  }

  // GET /clan/{id}
  async getClan(id: number): Promise<BhApiClan | null> {
    return this.call(`/clan/${id}`);
  }

  // GET /legend/all
  async getAllLegends(): Promise<BhApiLegend[]> {
    return this.call<BhApiLegend[]>(`/legend/all`) ?? [];
  }

  // GET /legend/{id}
  async getLegend(id: number): Promise<BhApiLegendFull | null> {
    return this.call(`/legend/${id}`);
  }

  private async call<T>(endpoint: string): Promise<T | null> {
    await this.burst.acquire();
    await this.sustained.acquire();

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE_URL}${endpoint}${separator}api_key=${this.apiKey}`;

    const res = await fetch(url);

    if (res.status === 404) return null;

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await Bun.sleep((retryAfter + 1) * 1000);
      return this.call<T>(endpoint); // retry once
    }

    if (!res.ok) {
      throw new Error(`Brawlhalla API error: ${res.status} ${res.statusText} for ${endpoint}`);
    }

    return res.json() as Promise<T>;
  }
}
```

3. Update `packages/bhapi/src/index.ts`:

```typescript
export { BhApiClient, type BhApiClientOptions } from './client';
export { TokenBucket, type TokenBucketOptions } from './rate-limiter';
export * from './types';
```

4. Commit:

```bash
git add packages/bhapi/
git commit -m "feat(bhapi): add typed api client with dual rate limiter"
```

---

## Phase 4: Queue System

### Task 4.1: Bun-native Redis Streams queue

Build the queue abstraction over Redis Streams with consumer groups, concurrency, retries, and dead letter queue.

**Files:**

- Create: `apps/api/src/queue/queue.ts`
- Create: `apps/api/src/queue/queue.test.ts`
- Create: `apps/api/src/queue/dedup.ts`

**Steps:**

1. Create `apps/api/src/queue/queue.ts`:

```typescript
import type { Redis } from 'ioredis';

export interface QueueOptions {
  concurrency?: number;
  retries?: number;
  backoffMs?: number;
}

export interface Queue<T> {
  enqueue(data: T): Promise<boolean>;
  start(): Promise<void>;
  stop(): void;
  depth(): Promise<number>;
}

export function createQueue<T>(redis: Redis, name: string, handler: (data: T) => Promise<void>, opts: QueueOptions = {}): Queue<T> {
  const { concurrency = 5, retries = 3, backoffMs = 1000 } = opts;
  const stream = `queue:${name}`;
  const group = `${name}-workers`;
  const consumer = `${name}-${crypto.randomUUID().slice(0, 8)}`;
  let running = 0;
  let stopped = false;

  async function init() {
    try {
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch {
      // Group already exists — fine
    }
  }

  async function enqueue(data: T): Promise<boolean> {
    await redis.xadd(stream, '*', 'data', JSON.stringify(data));
    return true;
  }

  async function depth(): Promise<number> {
    const info = await redis.xinfo('GROUPS', stream).catch(() => []);
    if (!Array.isArray(info) || info.length === 0) return 0;
    const groupInfo = info[0] as string[];
    const lagIndex = groupInfo.indexOf('lag');
    if (lagIndex !== -1) return Number(groupInfo[lagIndex + 1]);

    // Fallback: count pending
    const pending = await redis.xpending(stream, group);
    return Array.isArray(pending) ? Number(pending[0]) : 0;
  }

  async function start() {
    await init();

    // First: claim any pending messages from dead consumers
    await claimPending();

    while (!stopped) {
      if (running >= concurrency) {
        await Bun.sleep(50);
        continue;
      }

      const messages = await redis.xreadgroup('GROUP', group, consumer, 'COUNT', String(concurrency - running), 'BLOCK', '2000', 'STREAMS', stream, '>');

      if (!messages || stopped) continue;

      for (const [, entries] of messages as [string, [string, string[]][]][]) {
        for (const [id, fields] of entries) {
          running++;
          processJob(id, JSON.parse(fields[1]) as T, retries).finally(() => {
            running--;
          });
        }
      }
    }
  }

  async function claimPending() {
    try {
      const pending = await redis.xpending(stream, group, '-', '+', '100');
      if (!Array.isArray(pending) || pending.length === 0) return;

      for (const entry of pending) {
        const [id] = entry as [string, string, number, number];
        // Claim messages idle for more than 30 seconds
        await redis.xclaim(stream, group, consumer, '30000', id);
      }
    } catch {
      // No pending messages or group doesn't exist yet
    }
  }

  async function processJob(id: string, data: T, attemptsLeft: number) {
    try {
      await handler(data);
      await redis.xack(stream, group, id);
      await redis.xdel(stream, id); // Clean up processed messages
    } catch (err) {
      if (attemptsLeft > 1) {
        const delay = backoffMs * (retries - attemptsLeft + 1);
        await Bun.sleep(delay);
        return processJob(id, data, attemptsLeft - 1);
      }

      // Dead letter
      await redis.xadd('queue:dlq', '*', 'source', name, 'data', JSON.stringify(data), 'error', String(err), 'timestamp', new Date().toISOString());
      await redis.xack(stream, group, id);
      await redis.xdel(stream, id);
    }
  }

  function stop() {
    stopped = true;
  }

  return { enqueue, start, stop, depth };
}
```

2. Create `apps/api/src/queue/dedup.ts`:

```typescript
import type { Redis } from 'ioredis';

/**
 * Deduplicates job creation using Redis SETNX with TTL.
 * Returns true if the job should be enqueued (not a duplicate).
 */
export async function tryDedup(redis: Redis, key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export function dedupKey(type: string, id: number): string {
  return `dedup:${type}:${id}`;
}
```

3. Commit:

```bash
git add apps/api/src/queue/
git commit -m "feat(api): add bun-native redis streams queue with dedup"
```

---

## Phase 5: API Server (Hono + tRPC)

### Task 5.1: Hono server + tRPC setup

Wire up the Hono HTTP server with tRPC middleware and a health endpoint.

**Files:**

- Create: `apps/api/src/trpc/context.ts`
- Create: `apps/api/src/trpc/trpc.ts`
- Create: `apps/api/src/router/index.ts`
- Create: `apps/api/src/router/status.router.ts`
- Update: `apps/api/src/serve.ts`

**Steps:**

1. Create `apps/api/src/trpc/trpc.ts`:

```typescript
import { initTRPC } from '@trpc/server';
import type { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
```

2. Create `apps/api/src/trpc/context.ts`:

```typescript
import type { Database } from '@brawltome/database';
import type { BhApiClient } from '@brawltome/bhapi';
import type { Redis } from 'ioredis';

export interface Context {
  db: Database;
  bhapi: BhApiClient;
  redis: Redis;
}

export function createContext(deps: Context): Context {
  return deps;
}
```

3. Create `apps/api/src/router/status.router.ts`:

```typescript
import { router, publicProcedure } from '../trpc/trpc';

export const statusRouter = router({
  health: publicProcedure.query(async ({ ctx }) => {
    const tokens = ctx.bhapi.remainingTokens;
    let status: 'healthy' | 'degraded' | 'down' = 'healthy';

    if (tokens < 20) status = 'degraded';
    if (tokens === 0) status = 'down';

    return { status };
  }),
});
```

4. Create `apps/api/src/router/index.ts`:

```typescript
import { router } from '../trpc/trpc';
import { statusRouter } from './status.router';

export const appRouter = router({
  status: statusRouter,
});

export type AppRouter = typeof appRouter;
```

5. Update `apps/api/src/serve.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';
import { createContext } from './trpc/context';
import { db } from '@brawltome/database';
import { BhApiClient } from '@brawltome/bhapi';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const bhapi = new BhApiClient({ apiKey: process.env.BRAWLHALLA_API_KEY! });

const app = new Hono();

app.use('/*', cors());

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: () => createContext({ db, bhapi, redis }),
  }),
);

app.get('/health', (c) => {
  return c.json({ status: 'healthy' });
});

const port = parseInt(process.env.PORT ?? '3000', 10);

export default {
  port,
  fetch: app.fetch,
};

console.log(`API server running on port ${port}`);
```

6. Test it runs:

```bash
cd apps/api && bun run src/serve.ts
# In another terminal:
curl http://localhost:3000/health
```

7. Commit:

```bash
git add apps/api/src/
git commit -m "feat(api): set up hono server with trpc and status router"
```

---

### Task 5.2: Player router

The main player lookup endpoint. Handles fetching existing players, triggering discovery for new ones, and queueing background refreshes when data is stale.

**Files:**

- Create: `apps/api/src/router/player.router.ts`
- Create: `apps/api/src/services/player.service.ts`
- Create: `apps/api/src/services/constants.ts`
- Update: `apps/api/src/router/index.ts`

**Why a service layer:** Keep tRPC routers thin (input validation + call service). Business logic lives in services so the worker can reuse it.

**Steps:**

1. Create `apps/api/src/services/constants.ts`:

```typescript
// TTLs (milliseconds)
export const RANKED_TTL_MS = 60 * 60 * 1000; // 1 hour
export const STATS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const CLAN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Tiered TTLs
export const TIERED_TTL = {
  hot: { ranked: 1 * 60 * 60 * 1000, stats: 6 * 60 * 60 * 1000 },
  warm: { ranked: 6 * 60 * 60 * 1000, stats: 24 * 60 * 60 * 1000 },
  cold: { ranked: Infinity, stats: Infinity }, // on-demand only
} as const;

// Token thresholds
export const DISCOVERY_MIN_TOKENS = 50;
export const JANITOR_MIN_TOKENS = 100;

// Queue limits
export const QUEUE_HARD_CAP = 200;
export const QUEUE_DISCOVERY_CAP = 100;
export const DEDUP_TTL_RANKED_SEC = 3600; // 1 hour
export const DEDUP_TTL_STATS_SEC = 43200; // 12 hours
export const DEDUP_TTL_CLAN_SEC = 3600; // 1 hour

// Valhallan
export const VALHALLAN_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // 2 hours

// Weapon name normalization
export const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
};
```

2. Create `apps/api/src/services/player.service.ts`:

```typescript
import { eq, ilike, or, desc, sql } from 'drizzle-orm';
import { player, playerStats, playerStatsLegend, playerRanked, playerRankedLegend, playerRankedTeam, playerWeaponStat, playerClan, playerAlias, ratingHistory, blacklist } from '@brawltome/database';
import type { Database } from '@brawltome/database';
import type { BhApiClient } from '@brawltome/bhapi';
import type { Redis } from 'ioredis';
import type { Queue } from '../queue/queue';
import { tryDedup, dedupKey } from '../queue/dedup';
import { TIERED_TTL, DISCOVERY_MIN_TOKENS, QUEUE_DISCOVERY_CAP, DEDUP_TTL_RANKED_SEC, DEDUP_TTL_STATS_SEC } from './constants';

export interface RefreshJobData {
  brawlhallaId: number;
}

interface PlayerServiceDeps {
  db: Database;
  bhapi: BhApiClient;
  redis: Redis;
  rankedQueue: Queue<RefreshJobData>;
  statsQueue: Queue<RefreshJobData>;
}

// In-flight discovery tracking
const discoveries = new Map<number, Promise<any>>();

export async function getPlayer({ db, bhapi, redis, rankedQueue, statsQueue }: PlayerServiceDeps, brawlhallaId: number) {
  // Check blacklist
  const blocked = await db.query.blacklist.findFirst({
    where: eq(blacklist.brawlhallaId, brawlhallaId),
  });
  if (blocked) return null;

  // Try to find existing player
  let p = await db.query.player.findFirst({
    where: eq(player.brawlhallaId, brawlhallaId),
    with: {
      stats: {
        with: {
          legends: true,
          weaponStats: true,
          clan: true,
        },
      },
      ranked: {
        with: {
          legends: true,
          teams: true,
        },
      },
      aliases: true,
    },
  });

  if (!p) {
    // Discovery flow
    return discoverPlayer({ db, bhapi, redis, rankedQueue, statsQueue }, brawlhallaId);
  }

  // Update view count and refresh tier
  const now = new Date();
  await db
    .update(player)
    .set({
      viewCount: sql`${player.viewCount} + 1`,
      lastViewedAt: now,
      refreshTier: 'hot',
    })
    .where(eq(player.brawlhallaId, brawlhallaId));

  // Check staleness and queue refreshes
  const tier = p.refreshTier ?? 'cold';
  const ttl = TIERED_TTL[tier as keyof typeof TIERED_TTL] ?? TIERED_TTL.cold;
  let isRefreshing = false;

  if (p.ranked?.lastUpdated) {
    const rankedAge = now.getTime() - p.ranked.lastUpdated.getTime();
    if (rankedAge > ttl.ranked) {
      const canDedup = await tryDedup(redis, dedupKey('ranked', brawlhallaId), DEDUP_TTL_RANKED_SEC);
      if (canDedup) {
        await rankedQueue.enqueue({ brawlhallaId });
        isRefreshing = true;
      }
    }
  }

  if (p.stats?.lastUpdated) {
    const statsAge = now.getTime() - p.stats.lastUpdated.getTime();
    if (statsAge > ttl.stats) {
      const canDedup = await tryDedup(redis, dedupKey('stats', brawlhallaId), DEDUP_TTL_STATS_SEC);
      if (canDedup) {
        await statsQueue.enqueue({ brawlhallaId });
        isRefreshing = true;
      }
    }
  }

  // Fetch rating history
  const history = await db.query.ratingHistory.findMany({
    where: eq(ratingHistory.brawlhallaId, brawlhallaId),
    orderBy: [desc(ratingHistory.recordedAt)],
    limit: 365, // Up to a year of daily snapshots
  });

  return { ...p, ratingHistory: history, isRefreshing };
}

async function discoverPlayer(deps: PlayerServiceDeps, brawlhallaId: number) {
  // Dedup concurrent discoveries
  const existing = discoveries.get(brawlhallaId);
  if (existing) return existing;

  // Check backpressure
  const queueDepth = (await deps.rankedQueue.depth()) + (await deps.statsQueue.depth());
  if (queueDepth > QUEUE_DISCOVERY_CAP) return null;
  if (deps.bhapi.remainingTokens < DISCOVERY_MIN_TOKENS) return null;

  const promise = (async () => {
    try {
      const stats = await deps.bhapi.getPlayerStats(brawlhallaId);
      if (!stats?.name) return null;

      const ranked = await deps.bhapi.getPlayerRanked(brawlhallaId);

      // Create base player record
      await deps.db
        .insert(player)
        .values({
          brawlhallaId,
          name: stats.name,
          region: ranked?.region ?? null,
          rating: ranked?.rating ?? 0,
          peakRating: ranked?.peak_rating ?? 0,
          tier: ranked?.tier ?? null,
          games: ranked?.games ?? 0,
          wins: ranked?.wins ?? 0,
          refreshTier: 'hot',
        })
        .onConflictDoNothing();

      // Queue full data refresh
      await deps.rankedQueue.enqueue({ brawlhallaId });
      await deps.statsQueue.enqueue({ brawlhallaId });

      // Return what we have so far
      return getPlayer(deps, brawlhallaId);
    } finally {
      discoveries.delete(brawlhallaId);
    }
  })();

  discoveries.set(brawlhallaId, promise);

  // Clean up stale discoveries after 30s
  setTimeout(() => discoveries.delete(brawlhallaId), 30_000);

  return promise;
}
```

3. Create `apps/api/src/router/player.router.ts`:

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import { getPlayer } from '../services/player.service';

// Note: queues are initialized in serve.ts and attached to context
// For now, this shows the router shape — queue wiring comes in Task 5.4

export const playerRouter = router({
  byId: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    // TODO: wire up queues from context
    return null; // placeholder until queues are in context
  }),
});
```

4. Update `apps/api/src/router/index.ts`:

```typescript
import { router } from '../trpc/trpc';
import { statusRouter } from './status.router';
import { playerRouter } from './player.router';

export const appRouter = router({
  status: statusRouter,
  player: playerRouter,
});

export type AppRouter = typeof appRouter;
```

5. Commit:

```bash
git add apps/api/src/
git commit -m "feat(api): add player service with discovery, dedup, and tiered TTL"
```

---

### Task 5.3: Search, leaderboard, and clan routers

These follow the same pattern as the player router. Implement search (fuzzy local search), leaderboard (1v1/2v2 with region/sort), and clan lookup.

**Files:**

- Create: `apps/api/src/router/search.router.ts`
- Create: `apps/api/src/router/leaderboard.router.ts`
- Create: `apps/api/src/router/clan.router.ts`
- Create: `apps/api/src/services/search.service.ts`
- Create: `apps/api/src/services/leaderboard.service.ts`
- Create: `apps/api/src/services/clan.service.ts`
- Update: `apps/api/src/router/index.ts`

**This is a large task.** Implement one router at a time and commit each.

The logic for each service mirrors v1 closely — refer to the existing code in:

- `apps/api/src/search/search.service.ts` (v1) for search logic
- `apps/api/src/leaderboard/leaderboard.service.ts` (v1) for leaderboard logic
- `apps/api/src/clan/clan.service.ts` (v1) for clan logic

Key changes from v1:

- Use Drizzle query builder instead of Prisma
- Leaderboard queries hit dedicated leaderboard tables (populated by worker) instead of the player table
- Search uses `ilike` for case-insensitive matching
- All functions take `deps` object instead of using class injection

**I'll leave the exact implementations to the executor** since they're direct translations of v1 logic into Drizzle syntax. The patterns established in `player.service.ts` (Task 5.2) show how to structure each service.

---

### Task 5.4: Wire queues into context

Update the tRPC context to include queue instances so routers can enqueue jobs.

**Files:**

- Update: `apps/api/src/trpc/context.ts`
- Update: `apps/api/src/serve.ts`
- Update: `apps/api/src/router/player.router.ts`

**Steps:**

1. Update context to include queues:

```typescript
// apps/api/src/trpc/context.ts
import type { Database } from '@brawltome/database';
import type { BhApiClient } from '@brawltome/bhapi';
import type { Redis } from 'ioredis';
import type { Queue } from '../queue/queue';
import type { RefreshJobData } from '../services/player.service';

export interface Context {
  db: Database;
  bhapi: BhApiClient;
  redis: Redis;
  rankedQueue: Queue<RefreshJobData>;
  statsQueue: Queue<RefreshJobData>;
  clanQueue: Queue<{ clanId: number }>;
}
```

2. Update `serve.ts` to create queues and pass them to context:

```typescript
import { createQueue } from './queue/queue';

// ... existing redis/bhapi setup ...

const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async () => {}, { concurrency: 0 });
const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async () => {}, { concurrency: 0 });
const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async () => {}, { concurrency: 0 });

// API only enqueues — it doesn't process. concurrency:0 means no consumer loop.
// The worker (worker.ts) starts the consumers.

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: () => createContext({ db, bhapi, redis, rankedQueue, statsQueue, clanQueue }),
  }),
);
```

3. Commit:

```bash
git add apps/api/src/
git commit -m "feat(api): wire queues into trpc context"
```

---

## Phase 6: Worker

### Task 6.1: Refresh processors

The worker consumes queue jobs and processes them. Each job type (ranked, stats, clan) has its own handler.

**Files:**

- Create: `apps/api/src/services/refresh.service.ts`
- Update: `apps/api/src/worker.ts`

**Why in `apps/api/src/`:** API and worker share the same codebase (same package), just different entrypoints. The worker imports services from the same `src/` directory.

**Steps:**

1. Create `apps/api/src/services/refresh.service.ts`:

This file contains the three job handlers. The logic is a direct translation of `apps/worker/src/queue/refresh.processor.ts` from v1, but using Drizzle instead of Prisma.

```typescript
import { eq, and } from 'drizzle-orm';
import { player, playerAlias, playerRanked, playerRankedLegend, playerRankedTeam, playerStats, playerStatsLegend, playerWeaponStat, playerClan, clan, clanMember, ratingHistory } from '@brawltome/database';
import type { Database } from '@brawltome/database';
import type { BhApiClient } from '@brawltome/bhapi';
import { VALHALLAN_GRACE_PERIOD_MS, WEAPON_NAME_MAP } from './constants';

interface RefreshDeps {
  db: Database;
  bhapi: BhApiClient;
}

// ---- REFRESH RANKED ----

export async function processRefreshRanked({ db, bhapi }: RefreshDeps, brawlhallaId: number) {
  const data = await bhapi.getPlayerRanked(brawlhallaId);
  if (!data) return;

  await db.transaction(async (tx) => {
    // Check for name change → create alias
    const existing = await tx.query.player.findFirst({
      where: eq(player.brawlhallaId, brawlhallaId),
      columns: { name: true, tier: true, valhallanConfirmedAt: true },
    });

    if (existing && existing.name !== data.name) {
      await tx
        .insert(playerAlias)
        .values({
          brawlhallaId,
          key: existing.name.toLowerCase(),
          value: existing.name,
        })
        .onConflictDoNothing();
    }

    // Valhallan grace period
    let tier = data.tier;
    if (existing?.tier === 'Valhallan' && data.tier !== 'Valhallan' && existing.valhallanConfirmedAt && Date.now() - existing.valhallanConfirmedAt.getTime() < VALHALLAN_GRACE_PERIOD_MS) {
      tier = 'Valhallan';
    }

    // Update player
    await tx
      .update(player)
      .set({
        name: data.name,
        region: data.region,
        rating: data.rating,
        peakRating: data.peak_rating,
        tier,
        games: data.games,
        wins: data.wins,
        lastUpdated: new Date(),
      })
      .where(eq(player.brawlhallaId, brawlhallaId));

    // Upsert ranked record
    await tx
      .insert(playerRanked)
      .values({ brawlhallaId, lastUpdated: new Date() })
      .onConflictDoUpdate({
        target: playerRanked.brawlhallaId,
        set: { lastUpdated: new Date() },
      });

    // Replace legends
    await tx.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, brawlhallaId));
    if (data.legends.length > 0) {
      await tx.insert(playerRankedLegend).values(
        data.legends.map((l) => ({
          brawlhallaId,
          legendId: l.legend_id,
          legendNameKey: l.legend_name_key,
          rating: l.rating,
          peakRating: l.peak_rating,
          tier: l.tier,
          wins: l.wins,
          games: l.games,
        })),
      );
    }

    // Replace teams
    await tx.delete(playerRankedTeam).where(eq(playerRankedTeam.brawlhallaId, brawlhallaId));
    if (data['2v2'].length > 0) {
      await tx.insert(playerRankedTeam).values(
        data['2v2'].map((t) => ({
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
      );
    }

    // Snapshot rating history (only if changed)
    const lastSnapshot = await tx.query.ratingHistory.findFirst({
      where: eq(ratingHistory.brawlhallaId, brawlhallaId),
      orderBy: (rh, { desc }) => [desc(rh.recordedAt)],
    });

    if (!lastSnapshot || lastSnapshot.rating !== data.rating || lastSnapshot.games !== data.games) {
      await tx.insert(ratingHistory).values({
        brawlhallaId,
        rating: data.rating,
        peakRating: data.peak_rating,
        tier: data.tier,
        games: data.games,
        wins: data.wins,
      });
    }
  });
}

// ---- REFRESH STATS ----

export async function processRefreshStats({ db, bhapi }: RefreshDeps, brawlhallaId: number) {
  const data = await bhapi.getPlayerStats(brawlhallaId);
  if (!data) return;

  const parseDmg = (s: string): bigint => BigInt(s || '0');

  // Build weapon aggregation
  const weaponMap = new Map<string, { timeHeld: number; damage: bigint; kos: number }>();

  // TODO: Need legend data cache to map legendId → weaponOne/weaponTwo names
  // For now, weapon aggregation is deferred until GameDataCache is built (Phase 7)

  const filteredLegends = data.legends.filter((l) => l.legend_id !== 0);
  const matchTimeTotal = filteredLegends.reduce((sum, l) => sum + l.matchtime, 0);

  await db.transaction(async (tx) => {
    // Update player name if needed
    await tx.update(player).set({ name: data.name, lastUpdated: new Date() }).where(eq(player.brawlhallaId, brawlhallaId));

    // Upsert stats
    await tx
      .insert(playerStats)
      .values({
        brawlhallaId,
        lastUpdated: new Date(),
        xp: data.xp,
        level: data.level,
        xpPercentage: data.xp_percentage,
        games: data.games,
        wins: data.wins,
        matchTimeTotal,
        damageBomb: parseDmg(data.damagebomb),
        damageMine: parseDmg(data.damagemine),
        damageSpikeball: parseDmg(data.damagespikeball),
        damageSidekick: parseDmg(data.damagesidekick),
        hitSnowball: data.hitsnowball,
        koBomb: data.kobomb,
        koMine: data.komine,
        koSpikeball: data.kospikeball,
        koSidekick: data.kosidekick,
        koSnowball: data.kosnowball,
      })
      .onConflictDoUpdate({
        target: playerStats.brawlhallaId,
        set: {
          lastUpdated: new Date(),
          xp: data.xp,
          level: data.level,
          xpPercentage: data.xp_percentage,
          games: data.games,
          wins: data.wins,
          matchTimeTotal,
          damageBomb: parseDmg(data.damagebomb),
          damageMine: parseDmg(data.damagemine),
          damageSpikeball: parseDmg(data.damagespikeball),
          damageSidekick: parseDmg(data.damagesidekick),
          hitSnowball: data.hitsnowball,
          koBomb: data.kobomb,
          koMine: data.komine,
          koSpikeball: data.kospikeball,
          koSidekick: data.kosidekick,
          koSnowball: data.kosnowball,
        },
      });

    // Replace legends
    await tx.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, brawlhallaId));
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
      );
    }

    // Handle clan
    if (data.clan) {
      await tx
        .insert(playerClan)
        .values({
          brawlhallaId,
          clanName: data.clan.clan_name,
          clanId: data.clan.clan_id,
          clanXp: parseDmg(data.clan.clan_xp),
          clanLifetimeXp: data.clan.clan_lifetime_xp,
          personalXp: data.clan.personal_xp,
        })
        .onConflictDoUpdate({
          target: playerClan.brawlhallaId,
          set: {
            clanName: data.clan.clan_name,
            clanId: data.clan.clan_id,
            clanXp: parseDmg(data.clan.clan_xp),
            clanLifetimeXp: data.clan.clan_lifetime_xp,
            personalXp: data.clan.personal_xp,
          },
        });
    } else {
      await tx.delete(playerClan).where(eq(playerClan.brawlhallaId, brawlhallaId));
    }
  });
}

// ---- REFRESH CLAN ----

export async function processRefreshClan({ db, bhapi }: RefreshDeps, clanId: number) {
  const data = await bhapi.getClan(clanId);
  if (!data) return;

  await db.transaction(async (tx) => {
    // Upsert clan
    await tx
      .insert(clan)
      .values({
        clanId: data.clan_id,
        clanName: data.clan_name,
        clanCreateDate: new Date(data.clan_create_date * 1000),
        clanXp: BigInt(data.clan_xp || '0'),
        clanLifetimeXp: data.clan_lifetime_xp,
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: clan.clanId,
        set: {
          clanName: data.clan_name,
          clanXp: BigInt(data.clan_xp || '0'),
          clanLifetimeXp: data.clan_lifetime_xp,
          lastUpdated: new Date(),
        },
      });

    // Replace members
    await tx.delete(clanMember).where(eq(clanMember.clanId, data.clan_id));
    if (data.clan.length > 0) {
      await tx.insert(clanMember).values(
        data.clan.map((m) => ({
          clanId: data.clan_id,
          brawlhallaId: m.brawlhalla_id,
          name: m.name,
          rank: m.rank,
          joinDate: new Date(m.join_date * 1000),
          xp: m.xp,
        })),
      );
    }
  });
}
```

2. Update `apps/api/src/worker.ts`:

```typescript
import { db } from '@brawltome/database';
import { BhApiClient } from '@brawltome/bhapi';
import Redis from 'ioredis';
import { createQueue } from './queue/queue';
import { processRefreshRanked, processRefreshStats, processRefreshClan } from './services/refresh.service';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const bhapi = new BhApiClient({ apiKey: process.env.BRAWLHALLA_API_KEY! });
const deps = { db, bhapi };

// Create queues with handlers
const rankedQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-ranked', async (data) => processRefreshRanked(deps, data.brawlhallaId), { concurrency: 5, retries: 3, backoffMs: 1000 });

const statsQueue = createQueue<{ brawlhallaId: number }>(redis, 'refresh-stats', async (data) => processRefreshStats(deps, data.brawlhallaId), { concurrency: 3, retries: 3, backoffMs: 1000 });

const clanQueue = createQueue<{ clanId: number }>(redis, 'refresh-clan', async (data) => processRefreshClan(deps, data.clanId), { concurrency: 2, retries: 3, backoffMs: 1000 });

// Start all consumers
console.log('Worker starting...');
Promise.all([rankedQueue.start(), statsQueue.start(), clanQueue.start()]).catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Worker shutting down...');
  rankedQueue.stop();
  statsQueue.stop();
  clanQueue.stop();
  process.exit(0);
});

console.log('Worker running. Queues: refresh-ranked(5), refresh-stats(3), refresh-clan(2)');
```

3. Commit:

```bash
git add apps/api/src/
git commit -m "feat(api): add refresh processors and worker entrypoint"
```

---

### Task 6.2: Janitor service

The background maintenance service that crawls leaderboards, backfills data, and maintains freshness. Uses Redis-backed cursors and a distributed lock.

**Files:**

- Create: `apps/api/src/services/janitor.service.ts`
- Update: `apps/api/src/worker.ts`

**This is the most complex service.** Refer to `apps/worker/src/janitor/janitor.service.ts` (v1) for the full logic. Key changes:

- Uses `setInterval` instead of NestJS `@Cron` decorator
- Redis lock logic is the same (SET NX + Lua heartbeat)
- Cursor management is the same (Redis keys)
- Respects token budgets (janitor gets 30% = 54 tokens/15min)
- Clan backfill respects queue depth caps

**I'll leave the exact implementation to the executor** since it's a direct translation of v1 logic. The structure is:

```typescript
// apps/api/src/services/janitor.service.ts

export function startJanitor(deps: JanitorDeps) {
  let tick = 0;

  const interval = setInterval(async () => {
    const hasLock = await acquireLock(deps.redis);
    if (!hasLock) return;

    tick++;

    try {
      // 1. Check token budget
      if (deps.bhapi.remainingTokens < JANITOR_MIN_TOKENS) return;

      // 2. Hot pages (every tick)
      await syncHotPages(deps, '1v1');
      await syncHotPages(deps, '2v2');

      // 3. Cold pages (every 10th tick)
      if (tick % 10 === 0) {
        await syncColdPages(deps, '1v1');
        await syncColdPages(deps, '2v2');
      }

      // 4. Regional (rotate 1 region per tick)
      await syncRegional(deps, tick);

      // 5. Clan backfill
      await backfillClans(deps);

      // 6. Valhallan confirmation
      await confirmValhallans(deps);
    } finally {
      await renewLock(deps.redis);
    }
  }, 60_000); // Every minute

  return () => clearInterval(interval);
}
```

Commit when done:

```bash
git add apps/api/src/services/janitor.service.ts apps/api/src/worker.ts
git commit -m "feat(api): add janitor service with leaderboard sync and clan backfill"
```

---

## Phase 7: Game Data Cache

### Task 7.1: Legend cache + weapon aggregation

In-memory cache of legend data for mapping legendId → weapon names, used by refresh processors and API enrichment.

**Files:**

- Create: `apps/api/src/services/game-data.service.ts`

```typescript
import { eq } from 'drizzle-orm';
import { legend } from '@brawltome/database';
import type { Database } from '@brawltome/database';
import type { BhApiClient } from '@brawltome/bhapi';
import { WEAPON_NAME_MAP } from './constants';

interface LegendData {
  legendId: number;
  legendNameKey: string;
  bioName: string;
  weaponOne: string;
  weaponTwo: string;
}

let legendCache: Map<number, LegendData> = new Map();
let legendByKey: Map<string, LegendData> = new Map();

export async function initGameData(db: Database, bhapi: BhApiClient) {
  // Try DB first
  const dbLegends = await db.query.legend.findMany();

  if (dbLegends.length === 0) {
    // Seed from API
    const apiLegends = await bhapi.getAllLegends();
    for (const l of apiLegends) {
      await db
        .insert(legend)
        .values({
          legendId: l.legend_id,
          legendNameKey: l.legend_name_key,
          bioName: l.bio_name,
          bioAka: l.bio_aka,
          bioQuoteAboutAttrib: '',
          weaponOne: l.weapon_one,
          weaponTwo: l.weapon_two,
          strength: l.strength,
          dexterity: l.dexterity,
          defense: l.defense,
          speed: l.speed,
        })
        .onConflictDoNothing();
    }
    return initGameData(db, bhapi); // Reload from DB
  }

  legendCache = new Map(dbLegends.map((l) => [l.legendId, l]));
  legendByKey = new Map(dbLegends.map((l) => [l.legendNameKey, l]));
}

export function getLegendById(id: number): LegendData | undefined {
  return legendCache.get(id);
}

export function getLegendByKey(key: string): LegendData | undefined {
  return legendByKey.get(key);
}

export function normalizeWeaponName(name: string): string {
  return WEAPON_NAME_MAP[name] ?? name;
}

export function aggregateWeapons(
  legends: Array<{
    legendId: number;
    damageWeaponOne: bigint;
    damageWeaponTwo: bigint;
    timeHeldWeaponOne: number;
    timeHeldWeaponTwo: number;
    koWeaponOne: number;
    koWeaponTwo: number;
  }>,
): Array<{ weapon: string; timeHeld: number; damage: bigint; kos: number }> {
  const map = new Map<string, { timeHeld: number; damage: bigint; kos: number }>();

  for (const l of legends) {
    const legendData = getLegendById(l.legendId);
    if (!legendData) continue;

    const w1 = normalizeWeaponName(legendData.weaponOne);
    const w2 = normalizeWeaponName(legendData.weaponTwo);

    const e1 = map.get(w1) ?? { timeHeld: 0, damage: 0n, kos: 0 };
    e1.timeHeld += l.timeHeldWeaponOne;
    e1.damage += l.damageWeaponOne;
    e1.kos += l.koWeaponOne;
    map.set(w1, e1);

    const e2 = map.get(w2) ?? { timeHeld: 0, damage: 0n, kos: 0 };
    e2.timeHeld += l.timeHeldWeaponTwo;
    e2.damage += l.damageWeaponTwo;
    e2.kos += l.koWeaponTwo;
    map.set(w2, e2);
  }

  return Array.from(map.entries())
    .map(([weapon, stats]) => ({ weapon, ...stats }))
    .sort((a, b) => b.timeHeld - a.timeHeld);
}
```

Commit:

```bash
git add apps/api/src/services/game-data.service.ts
git commit -m "feat(api): add game data cache with legend lookup and weapon aggregation"
```

---

## Phase 8: Frontend (Next.js)

### Task 8.1: Next.js scaffold + tRPC wiring

Set up Next.js with App Router, Tailwind, and tRPC client.

**Files:**

- Create: `apps/web/next.config.js`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/trpc.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/app/globals.css`

**Steps:**

1. Initialize Next.js (or scaffold manually). The key files:

`apps/web/src/lib/trpc.ts` — tRPC client setup:

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@brawltome/api/router'; // Need to export this type

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// Server-side caller (for RSC)
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiUrl}/trpc`,
    }),
  ],
});
```

Note: You'll need to export `AppRouter` type from the API package. Add to `apps/api/package.json` exports:

```json
{
  "exports": {
    ".": "./src/serve.ts",
    "./router": "./src/router/index.ts"
  }
}
```

2. Set up the basic layout with Tailwind, theme provider, and navigation.

3. Create the landing page with search bar placeholder and leaderboard placeholder.

**I'll leave the exact frontend implementation to the executor.** The component structure is defined in the design doc. Key patterns:

- RSC pages fetch via tRPC server caller
- Client components use tRPC React Query
- Suspense boundaries per data section on player/clan pages
- URL search params for leaderboard state

Commit after each page:

```bash
git commit -m "feat(web): scaffold next.js with trpc and landing page"
git commit -m "feat(web): add player profile page with suspense streaming"
git commit -m "feat(web): add clan profile page"
git commit -m "feat(web): add leaderboard with filters and pagination"
git commit -m "feat(web): add search bar with debounced autocomplete"
```

---

### Task 8.2: Rating chart component (new feature)

Add the rating history chart to the player profile page.

**Files:**

- Create: `apps/web/src/components/player/rating-chart.tsx`

Use a lightweight chart library. Recommended: `recharts` (most mature React chart lib).

```bash
cd apps/web && bun add recharts
```

The component receives rating history data and renders a line chart with:

- X axis: date
- Y axis: rating
- Tooltip showing exact rating, tier, games, wins at each point
- Responsive sizing

---

## Phase 9: Discord Bot

### Task 9.1: Rewrite with tRPC client

The Discord bot is the simplest app — 3 slash commands consuming the API via tRPC.

**Files:**

- Create: `apps/discord-bot/src/index.ts`
- Create: `apps/discord-bot/src/commands/player.ts`
- Create: `apps/discord-bot/src/commands/clan.ts`
- Create: `apps/discord-bot/src/commands/status.ts`
- Create: `apps/discord-bot/src/lib/trpc.ts`
- Create: `apps/discord-bot/src/lib/embeds.ts`

The logic is a direct translation of v1 (`apps/discord-bot/src/`), replacing raw `fetch` calls with typed tRPC client calls:

```typescript
// apps/discord-bot/src/lib/trpc.ts
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@brawltome/api/router';

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${process.env.API_URL}/trpc`,
    }),
  ],
});
```

```typescript
// Usage in commands:
const player = await api.player.byId.query({ id: brawlhallaId });
const clan = await api.clan.byId.query({ id: clanId });
const status = await api.status.health.query();
```

Commit:

```bash
git add apps/discord-bot/
git commit -m "feat(discord-bot): rewrite with trpc client"
```

---

## Phase 10: Deployment

### Task 10.1: Dockerfiles

**Files:**

- Create: `Dockerfile` (root — for api, worker, discord-bot)
- Create: `apps/web/Dockerfile`
- Update: `docker-compose.yml`

Root Dockerfile (multi-stage, shared by api/worker/bot):

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

FROM base AS runtime
COPY --from=build /app .
USER bun
# CMD set per-service in docker-compose.yml
```

Web Dockerfile:

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY apps/web/package.json ./
COPY packages/ui/package.json ../packages/ui/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules node_modules
COPY apps/web/ .
COPY packages/ui/ ../packages/ui/
RUN bun run build

FROM base AS runtime
COPY --from=build /app/.next .next
COPY --from=build /app/public public
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json .
USER bun
CMD ["bun", "run", "start"]
```

Commit:

```bash
git add Dockerfile apps/web/Dockerfile docker-compose.yml
git commit -m "chore: add dockerfiles and docker-compose for coolify deployment"
```

---

### Task 10.2: CI/CD pipeline

**Files:**

- Update: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [master, v2-rewrite]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run build
      - run: bun test
```

Commit:

```bash
git add .github/workflows/ci.yml
git commit -m "chore: update ci pipeline for bun"
```

---

## Phase 11: Migration & Cleanup

### Task 11.1: Seed scripts

**Files:**

- Create: `packages/database/src/seed-legends.ts`

Script to seed legend data from the Brawlhalla API:

```bash
DATABASE_URL="..." BRAWLHALLA_API_KEY="..." bun run packages/database/src/seed-legends.ts
```

### Task 11.2: Update CLAUDE.md

Update the project instructions to reflect the new stack, commands, and structure.

### Task 11.3: Update README

Update with new setup instructions, tech stack, and commands.

### Task 11.4: Clean up v1 artifacts

Remove any remaining v1 files that weren't cleaned up in Phase 1:

- `libs/` directory remnants
- Old config files
- `security-review.txt`

---

## Execution Order Summary

| Phase | Description              | Depends On        | Estimated Tasks |
| ----- | ------------------------ | ----------------- | --------------- |
| 1     | Monorepo scaffold        | —                 | 2               |
| 2     | Database package         | Phase 1           | 2               |
| 3     | Bhapi client             | Phase 1           | 2               |
| 4     | Queue system             | Phase 1           | 1               |
| 5     | API server (Hono + tRPC) | Phases 2, 3, 4    | 4               |
| 6     | Worker                   | Phases 2, 3, 4, 5 | 2               |
| 7     | Game data cache          | Phases 2, 3       | 1               |
| 8     | Frontend                 | Phase 5           | 2               |
| 9     | Discord bot              | Phase 5           | 1               |
| 10    | Deployment               | All above         | 2               |
| 11    | Migration & cleanup      | All above         | 4               |

**Phases 2, 3, 4 can be done in parallel** since they're independent packages.

**Phases 8 and 9 can be done in parallel** since they're independent consumers of the API.

---

## Post-Merge: Clean Git History

After the rewrite is complete and merged, remove bot/AI accounts (Claude, CodeRabbit, Vercel, Dependabot, GitHub Actions) from the contributor list by rewriting commit authorship:

```bash
# Install git-filter-repo (recommended over filter-branch)
pip install git-filter-repo

# Rewrite all commits to a single author
git filter-repo --force --commit-callback '
commit.author_name = b"Nick Tacke"
commit.author_email = b"your@email.com"
commit.committer_name = b"Nick Tacke"
commit.committer_email = b"your@email.com"
'

# Force push (destructive — only do this once, after v2 is stable)
git push --force
```

**Important:**

- This rewrites ALL history — do it once, after the rewrite is stable
- Anyone with local clones will need to re-clone
- Back up the repo before running (or just ensure the remote is the backup)
- Only needed if you care about the contributor list being clean

---

## Known TODOs & Gaps

These items are called out explicitly so they don't get missed:

1. **Weapon aggregation in refresh-stats** — Task 6.1 has a TODO for integrating the game data cache. Must be wired up after Phase 7.
2. **Search service exact implementation** — Task 5.3 defers to executor. Port the fuzzy search logic from v1 `search.service.ts`.
3. **Leaderboard table population** — The janitor needs to populate dedicated leaderboard tables, not just update player records. This needs a `syncToLeaderboardTable` function in the janitor.
4. **Player router full wiring** — Task 5.2 creates the service but the router has a placeholder. Must be completed after queues are in context (Task 5.4).
5. **Web Dockerfile paths** — The multi-workspace Docker build may need adjusting for how Bun resolves workspace dependencies. Test locally before deploying.
6. **Drizzle bigint serialization** — `bigint` values can't be JSON serialized directly. tRPC will need a custom transformer or the values need to be converted to `string` | `number` at the router level before returning to clients.
7. **Environment variable validation** — Add a startup check (e.g., with Zod) that all required env vars are present. Currently just `process.env.X!` assertions.
8. **Blacklist management** — No admin API for managing the blacklist. Currently direct DB inserts. Consider adding a simple admin endpoint or CLI script.
9. **Discord bot emoji sync** — The v1 bot had emoji sync functionality. Decide if this is still needed or can be handled manually.
10. **Rate limiting on the API itself** — Hono has middleware for this. Add before going to production.
