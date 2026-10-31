# BrawlTome: guide for contributors and coding agents

BrawlTome tracks Brawlhalla players: profiles, rankings, clans, rating history, a Discord bot, and a Windows overlay.
The live site is https://brawltome.app. Read `README.md` for setup, then this file for how the repo works in practice.
What to work on next is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Layout

| Path | What lives there |
| --- | --- |
| `apps/api` | Hono + tRPC API **and** the operations worker (`dev:operations-worker`); composes every context |
| `apps/web` | Next.js 16 site |
| `apps/discord-bot` | discord.js slash-command bot (`/player`, `/clan`, `/status`) |
| `apps/desktop` | Tauri Windows overlay; `detection/` is a private submodule, Windows only |
| `apps/replay-bridge` | Bridge to the replay processor (host install in `infra/replay-bridge`) |
| `packages/contexts/*` | Domain modules (`@brawltome/<name>`): accounts, clan, discovery, player, ranking, refresh-operations, replay-analysis, request-admission, statistics. Each owns its schema, migrations and `composition.ts` entry point |
| `packages/database` | Drizzle setup; aggregates the context schemas |
| `packages/bhapi` | Brawlhalla API client (V0 keyed, V1 keyless) |
| `packages/contracts` | Generated OpenAPI + Rust contracts (CI checks they are up to date) |
| `packages/game-data`, `packages/telemetry` | Static game data; OpenTelemetry + metrics helpers |
| `tooling/architecture` | Dependency rules between packages (`bun run architecture:check`) |
| `tooling/database-migrations` | `migrate` and `rebuild:discovery` commands |
| `tooling/analytics-review` | Weekly product analytics review from Loki |
| `infra/app` | Production compose, zero-downtime `deploy.sh`, Postgres storage, backup verifier |
| `infra/observability` | Prometheus, Alertmanager, Loki, Tempo, Grafana, OTel collector |
| `docker-compose.yml` | Local development Postgres only (production is `infra/app/compose.yml`) |

## Commands

```bash
bun run lint            # biome
bun run typecheck
bun test                # Postgres-backed tests need Docker
bun run architecture:check
bun run infra:app:check
bun run infra:observability:check   # slow; run when touching infra/observability or packages/telemetry
```

Dead-lettered work is inspected and replayed with `bun run operations:dead-letters <list|inspect|replay|discard>`. It
needs `DEAD_LETTER_DATABASE_URL` plus `DEAD_LETTER_OPERATOR_TOKEN` and `DEAD_LETTER_OPERATOR_TOKENS` (see
`packages/contexts/refresh-operations/operator-auth.ts`), e.g. `bun run operations:dead-letters list`.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, migrations, tests, contracts, architecture and infra checks.
`observability-ci.yml` runs when `infra/observability/**`, `packages/telemetry/**` or root dependency/TS config change;
`desktop-ci.yml` (Windows) when `apps/desktop/**`, `packages/contracts/**`, `.gitmodules` or root dependency/TS config
change. Check each workflow's `paths` before assuming a change is covered.

## Production

- Hosting: one Dokploy VM (`ssh dokploy`), panel at panel.aidey.app. Cloudflare in front of `brawltome.app`,
  `api.brawltome.app` and `observability.brawltome.app` (Grafana).
- **Every push to `master` deploys the app** (Dokploy autodeploy, all paths). `infra/app/deploy.sh` builds, migrates
  while the old release still serves, then swaps api/web when healthy.
- The observability stack deploys separately from an immutable `observability-<sha>` tag:
  `bun run infra:observability:deploy` (see `infra/observability/deploy-via-dokploy.sh` for the required env).
- Backup verifier and storage helpers are host installs (`infra/app/backups/install.sh`), not part of a deploy.
- Alerting: see [`docs/operations/alerts.md`](docs/operations/alerts.md).

## Rules that are easy to break

- **Migrations must be backward compatible** with the release still serving during the swap: add first, drop or rename
  only in a later release.
- **Never let a deploy recreate Postgres.** `deploy.sh` uses `--no-recreate` for it; image or config changes need a
  deliberate maintenance-window restart.
- Traefik labels in `infra/app/compose.yml` hard-code Dokploy's generated router names. Recreating a domain in
  Dokploy means updating those labels.
- Postgres `max_connections` is 100 and a deploy briefly runs two APIs; watch pool sizes.
- Postgres data is on its own loop-mounted ext4 image (`/srv/brawltome/postgres`); host `df` does not show it.
- Brawlhalla V0 rate-limits short bursts well below its 180/15 min budget: smooth new V0 traffic, don't just budget it.
  V0 returns 503 during maintenance; the worker pauses the source.

## Working conventions

- Branch from `master`, one PR per change, conventional commit titles (`fix(worker): …`, `feat(web): …`).
- Read Greptile's review and confidence on every PR before merging.
- Prefer differentiators (overlay, replays, freshness) over copying competitor features.
