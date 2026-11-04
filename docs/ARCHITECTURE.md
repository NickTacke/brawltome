# Architecture

BrawlTome is one Postgres database, one API process, one operations worker and the apps around them. This page covers
how the backend code is split into modules and how those modules are loaded and migrated. For setup see
[`README.md`](../README.md); for working rules see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="architecture/overview-dark.png">
  <img src="architecture/overview.png" alt="Players and the desktop overlay reach Traefik through Cloudflare. Traefik routes the site to Next.js and the API. The API and the operations worker share PostgreSQL, and the worker calls the Brawlhalla API. The Discord bot calls the API. Backups go to Cloudflare R2. The replay bridge on a separate host claims jobs through Cloudflare.">
</picture>

## Modules

The domain code lives in `packages/modules/<name>`, published inside the repo as `@brawltome/<name>`. Each module owns
one Postgres schema and the migrations that create it, and exposes one `index.ts`.

| Module | Schema | Owns |
| --- | --- | --- |
| `accounts` | `accounts` | Discord sign-in, preferences, pinned players, primary player verification |
| `clan` | `clans` | Clan profiles and refreshes |
| `discovery` | `discovery` | Finding players and clans worth tracking |
| `player` | `players` | Profiles, career and ranked stats, freshness, name verification |
| `ranking` | `rankings` | Leaderboard snapshots and their retention |
| `refresh-operations` | `refresh_operations` | The job queue: leases, scheduling, dead letters |
| `replay-analysis` | `replay_analysis` | Replay analysis jobs |
| `request-admission` | `request_admission` | Rate limits for visitors and for the Brawlhalla API budget |
| `statistics` | `statistics` | Cohorts, legend meta, weapon usage, history |

Every `index.ts` exports a `<name>Module` object:

```ts
export const rankingModule = {
  name: 'ranking',
  dependsOn: ['refresh-operations'],
  migrations: rankingMigrationInventory,
} satisfies BrawltomeModule
```

`dependsOn` lists the modules that must be loaded beside it. Nothing else about a module is registered anywhere: the
rest of `index.ts` is plain exports, mostly `createPostgres<Thing>(database)` factories.

Modules are rebuilt one at a time. Until then a module keeps its old layout; see
[`packages/modules/README.md`](../packages/modules/README.md) for the target one.

## Shared code

`@brawltome/foundation` (`packages/foundation`) is what every module builds on:

- `createDatabase` and the `Database` and `Sql` types, a thin wrapper over postgres.js
- `parsePositiveInteger` and `requirePositiveInteger` for reading config
- the `Migration` type and the migration runner
- `BrawltomeModule` and `checkModuleList`
- `@brawltome/foundation/testing`, which has `createTestDatabase`. Only test files may import it.

`@brawltome/bhapi` is the Brawlhalla API client. `@brawltome/game-data`, `@brawltome/telemetry` and
`@brawltome/contracts` hold static data, metrics helpers and the generated contracts.

## How processes load modules

Each process has a list of the modules it needs:

| Process | List |
| --- | --- |
| API | `apps/api/src/modules.ts` (`apiModules`) |
| Operations worker | `apps/api/src/worker-modules.ts` (`workerModules`) |
| `bun run db:migrate` | `tooling/database-migrations/src/modules.ts` (`migrationModules`) |

The worker leaves out `replay-analysis`; the other two lists have all nine. At start-up `serve.ts` and
`operations-worker.ts` call `checkModuleList` on their list, which fails on a duplicate name, a missing dependency or a
dependency cycle. They then build the module factories by hand from one shared database client and pass the modules'
migrations to the readiness check, so a process reports unready until the schema has what it expects.

The API shares one database client between all its modules. The worker opens three clients by role: main, lease
renewals and discovery. Pool sizes and the connection budget are under Production in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#production).

## Migrations

A migration is a typed object (`Migration` in `packages/foundation/migration.ts`) with an `identity` like
`rankings/0002`: the owner name, then four digits. The owner name is the schema name with hyphens instead of
underscores (`refresh-operations/0007`). A migration also has a `predecessor` in the same module, a `checksum` of its
SQL, and optionally `requires`: identities from other modules that must run first. The files sit in each module's
`migrations/` folder.

`db:migrate` runs `tooling/database-migrations/src/cli.ts`. It collects the migrations of every module in
`migrationModules`, orders them with `orderMigrations`, takes an advisory lock and applies what is still pending.

The order is:

1. The 84 migrations production had applied before this scheme are listed in
   `packages/foundation/migrations/deployed-order.ts`. That list is frozen: never edit, reorder or extend it.
2. Every later migration comes after its `predecessor` and its `requires`. When several are ready, the one with the
   lowest identity goes first.

So a new migration only needs its own declaration. It doesn't go into any central list. The runner refuses a changed
checksum on an applied migration, a missing predecessor, an unknown `requires` and cycles.

Migrations still have to be backward compatible with the release that serves during a deploy; see
[`CONTRIBUTING.md`](../CONTRIBUTING.md#rules-that-are-easy-to-break).

## Checks

`bun run architecture:check` (`tooling/architecture`) enforces the boundaries:

- A module's `package.json` exports only `.`, which is its `index.ts`. Other packages can't import deeper paths.
- `@brawltome/foundation/testing` is test-only.
- A module may import only the modules the policy lists for it (`capabilityDependencies` in
  `tooling/architecture/src/current-policy.ts`).
- A module's non-test, non-migration source can't hold SQL that names another module's schema. Three exceptions exist
  today, all reaching into `refresh_operations`, and are tracked in issue #388.

The policy file is where a new module is registered for these checks, along with the three module lists above.

## API

The API is Hono. tRPC (`apps/api/src/router`, `apps/api/src/trpc`) serves the site and the bot at `/trpc/*`, and a few
plain routes live in `apps/api/src/routes`. oRPC (`apps/api/src/orpc`) runs beside it while the modules move over one
at a time: `/rpc/*` speaks the oRPC protocol, `/v1/*` is the same router as plain HTTP, and `/openapi.json` is the
generated OpenAPI document, which lists only what `/v1` serves. So far there is one public procedure, `status`. tRPC
stays until each module's routes have moved.
