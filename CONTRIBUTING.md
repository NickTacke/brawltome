# Contributing to BrawlTome

BrawlTome tracks Brawlhalla players: profiles, rankings, clans, rating history, a Discord bot, and a Windows overlay.
The live site is https://brawltome.app. Read `README.md` for setup, then this guide for how the repo works in practice.
What to work on next is in [`docs/ROADMAP.md`](docs/ROADMAP.md). How the modules fit together is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository map

| Path | What lives there |
| --- | --- |
| `apps/api` | Hono + tRPC API **and** the operations worker (`dev:operations-worker`); loads the modules listed in `src/modules.ts` and `src/worker-modules.ts` |
| `apps/web` | Next.js 16 site |
| `apps/discord-bot` | discord.js slash-command bot (`/player`, `/clan`, `/status`) |
| `apps/desktop` | Tauri Windows overlay; `detection/` is a private submodule, Windows only |
| `apps/replay-bridge` | Bridge to the replay processor (host install in `infra/replay-bridge`) |
| `packages/modules/*` | Domain modules (`@brawltome/<name>`): accounts, clan, discovery, player, ranking, refresh-operations, replay-analysis, request-admission, statistics. Each owns its schema and migrations, and exposes one `index.ts` with a `<name>Module` object; layout in [`packages/modules/README.md`](packages/modules/README.md) |
| `packages/foundation` | Shared database client, the migration and module types, and the migration runner |
| `packages/bhapi` | Brawlhalla API client (V0 keyed, V1 keyless) |
| `packages/contracts` | Generated OpenAPI + Rust contracts (CI checks they are up to date) |
| `packages/game-data`, `packages/telemetry` | Static game data; OpenTelemetry + metrics helpers |
| `tooling/architecture` | Dependency and module-boundary rules (`bun run architecture:check`) |
| `tooling/database-migrations` | `migrate` command and the list of modules it migrates |
| `tooling/analytics-review` | Weekly product analytics review from Loki |
| `infra/app` | Production compose, zero-downtime `deploy.sh`, Postgres storage, backup verifier |
| `infra/observability` | Prometheus, Alertmanager, Loki, Tempo, Grafana, OTel collector |
| `docker-compose.yml` | Local development Postgres only (production is `infra/app/compose.yml`) |

## Commands

```bash
bun run lint            # biome, plus eslint for blank lines between statements
bun run typecheck
bun test                # Postgres-backed tests need Docker
bun run architecture:check
bun run infra:app:check
bun run infra:observability:check   # slow; run when touching infra/observability or packages/telemetry
```

A Postgres test gets its own migrated database from `createTestDatabase` in `@brawltome/foundation/testing`, which only
test files may import.

Dead-lettered work is inspected and replayed with `bun run operations:dead-letters <list|inspect|replay|discard>`. It
needs `DEAD_LETTER_DATABASE_URL` plus `DEAD_LETTER_OPERATOR_TOKEN` and `DEAD_LETTER_OPERATOR_TOKENS` (see
`packages/modules/refresh-operations/operator-auth.ts`), e.g. `bun run operations:dead-letters list`.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, migrations, tests, contracts, architecture and infra checks.
`observability-ci.yml` runs when `infra/observability/**`, `packages/telemetry/**` or root dependency/TS config change;
`desktop-ci.yml` (Windows) when `apps/desktop/**`, `packages/contracts/**`, `.gitmodules` or root dependency/TS config
change. Check each workflow's `paths` before assuming a change is covered.

## Production

- Hosting: one Dokploy VM (`ssh dokploy`), panel at panel.aidey.app. Cloudflare in front of `brawltome.app`,
  `api.brawltome.app` and `observability.brawltome.app` (Grafana).
- **Every push to `master` deploys the app once CI passes.** CI builds each image as `<sha>-candidate` while the
  checks run, promotes them to `ghcr.io/nicktacke/brawltome-<target>:<sha>` when every check is green, then asks
  Dokploy to deploy (autodeploy is off). `infra/app/deploy.sh` pulls those images, migrates while the old release
  still serves, then swaps api/web when healthy. A failed check means no deploy.
- Dokploy always deploys the current `master` head. To retry a failed deploy, rerun the `deploy` job of the latest
  `master` run; rerunning an older run still deploys the head. To go back to an older commit, revert on `master`.
  Never deploy from the Dokploy panel while a CI deploy is running.
- The observability stack deploys separately from an immutable `observability-<sha>` tag:
  `bun run infra:observability:deploy` (see `infra/observability/deploy-via-dokploy.sh` for the required env).
- Backup verifier and storage helpers are host installs (`infra/app/backups/install.sh`), not part of a deploy.
- Alerting: see [`docs/operations/alerts.md`](docs/operations/alerts.md).
- Database connections: the API shares one client between its modules and the worker opens three by role (main, lease
  renewals, discovery), sized in `apps/api/src/database-pools.ts`. postgres.js adds one LISTEN connection beside the
  API's and the worker's main client. With `c` = `OPERATIONS_TOTAL_CONCURRENCY` (default 8, at most 23):

  | client | connections |
  |---|---|
  | API (`brawltome-api`) | 20 + 1 listener |
  | worker main (`brawltome-operations-worker`) | c + 4, + 1 listener |
  | worker lease renewals (`brawltome-operations-worker-renewals`) | c |
  | worker discovery (`brawltome-operations-worker-discovery`) | 3 |
  | migration runner | 1 |

  The discovery pool keeps one connection more than the projection operations that use it, because a reconciliation
  can hold one connection while it waits for another; so `OPERATIONS_PROJECTION_CONCURRENCY` is at most 2.

  A deploy runs two APIs beside one worker (the worker is replaced, never overlapped), so the runtime role needs at
  most `2 × 21 + (c + 5) + c + 3 = 50 + 2c`: 96 at c = 23. Postgres allows 100 connections but keeps 3 for
  superusers, and `brawltome_runtime` isn't one, so the runtime role gets 97.
  With the migration runner the total is 97, under 100.
  `apps/api/tests/database-pools.test.ts` computes these numbers from the pool sizes and fails until this table and
  text match them.

## Rules that are easy to break

- **Migrations must be backward compatible** with the release still serving during the swap: add first, drop or rename
  only in a later release.
- **Never let a deploy recreate Postgres.** `deploy.sh` uses `--no-recreate` for it; image or config changes need a
  deliberate maintenance-window restart.
- Traefik labels in `infra/app/compose.yml` hard-code Dokploy's generated router names. Recreating a domain in
  Dokploy means updating those labels.
- Postgres `max_connections` is 100 and a deploy briefly runs two APIs; see the connection budget under Production
  before adding a client or changing a pool size.
- Modules share their process's client. Never hold a transaction open while calling another module or another query
  on the same client: each such call needs a second connection, and enough of them at once exhaust the pool.
- Postgres data is on its own loop-mounted ext4 image (`/srv/brawltome/postgres`); host `df` does not show it.
- Brawlhalla V0 rate-limits short bursts well below its 180/15 min budget: smooth new V0 traffic, don't just budget it.
  V0 returns 503 during maintenance; the worker pauses the source.

## Modules

- A module's `index.ts` is its only public surface. Import `@brawltome/<name>`, never a path inside it.
- Don't read or write another module's tables. Call what that module exports.
- Migrations live in the module that owns the table. When one needs another module's table first, list its identity in
  `requires`. A new migration is a file in the module's `migrations/` folder, imported in the module's `index.ts` and
  added to its `<name>MigrationInventory` array: the runner only reads that array. There is no central list; the order
  comes from `predecessor` and `requires`.
  `architecture:check` fails on a new migration that names another module's schema without such a `requires`.
- A new module is added to the three module lists, to `tooling/architecture/src/current-policy.ts` and to
  `tooling/architecture/tests/module-surfaces.test.ts`, with a dev dependency on it in
  `tooling/architecture/package.json`. The `Dockerfile` also needs a `COPY packages/modules/<name>/package.json` line,
  or the image's frozen install breaks.

## Working conventions

- Branch from `master`, one PR per change, conventional commit titles (`fix(worker): …`, `feat(web): …`).
- Prefer differentiators (overlay, replays, freshness) over copying competitor features.
