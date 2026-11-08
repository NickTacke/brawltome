# Clan

Stores each clan's profile and roster, and serves them to the website and the bot. This is the first module on the
new layout, so it is the example to copy for the others.

## What it owns

The `clans` schema. The tables are described in `db/tables.ts`:

- `clans`: one row per known clan
- `profiles`: name, xp, notice, tags, Discord invite and the rest of a clan's profile
- `profile_state`: when the profile was last checked and last succeeded, and where the data came from
- `members`: the roster, one row per player (a player is in at most one clan)
- `roster_state`: the same check and success times, for the roster
- `refresh_effects`: the clan side of a refresh lease, so a publish can check the lease in its own transaction
- `discovery_state`: one row with the source version
- `discovery_outbox`: one event per changed clan, for the discovery projection

`db/tables.ts` has every column of each table the code uses, because `tests/tables.test.ts` compares each column
with the database. The migrations in `migrations/` own the defaults, checks, indexes and triggers.

The V2 import left `legacy_archive`, `legacy_import_progress`, `legacy_import_ledger`, `legacy_import_rejections` and
`import_conflicts` behind. They still exist but aren't modelled. They can be dropped in a later migration.

## Layout

- `domain/`: types and rules (parsing the source, provenance, publication results). No database code.
- `db/`: `tables.ts` and one file per use case, for example `get-clan-profile.ts` and `publish-roster.ts`.
  `postgres-clans.ts` binds them to a database.
- `api/`: `procedures.ts` holds the oRPC procedures. `read-clan-profile.ts` and `read-player-clan-membership.ts`
  call the `db/` use cases with the database and turn the result into the public shape. `clan-profile-contract.ts`
  does that mapping for a clan, so the tRPC refresh can map a clan it has already read.
- `jobs/`: `refresh-clan.ts` fetches a section from the source and publishes it. `clan-refresh-job.ts` is the queue
  job that runs it, section by section. `clan-refresh-reservation.ts` reserves and activates the queue operation.
- `tests/`: domain, table, refresh, discovery source and read-during-refresh tests.

## Public surface

Everything other packages may import is exported from `index.ts`, and only what something outside the module uses:

- `clanModule`: the module object (name, migrations and the oRPC procedures)
- `readClanProfile` and `readPlayerClanMembership`: the reads the tRPC adapters share with the oRPC procedures
- `toClanProfileContract`: turns a stored clan into its public shape, for the tRPC refresh
- `createPostgresClans` and the `ClanQueries` type: the old closure, for the refresh paths until the queue is replaced
- `createPostgresClanDiscoverySource`, for the operations worker
- `createClanRefreshJob`, for the operations worker's job list
- `createClanRefreshReservations`, for the tRPC clan refresh, and `reserveClanRefresh`, for the API's queue tests
- the `ClanProvenance` type, for the API's test fixtures

## oRPC procedures

| Procedure                   | HTTP                        | Returns                                    |
| --------------------------- | --------------------------- | ------------------------------------------ |
| `clan.byId`                 | `GET /v1/clans/{id}`        | the clan profile, or null if never fetched |
| `clan.membershipByPlayerId` | `GET /v1/players/{id}/clan` | the player's clan id and name, or null     |

Both are also served at `/rpc/clan/*`. Both use `internalProcedure` from `@brawltome/foundation`, so they need the
internal secret.

Nothing calls the oRPC versions yet. The website's server (the clan page, and the player page for the membership) and
the Discord bot's `/clan` command still call the tRPC versions in `apps/api/src/router/clan.router.ts`. Those call the
same read functions, `readClanProfile` and `readPlayerClanMembership`, so both routes return the same data.

## Refresh

`clan.refresh` and `clan.refreshDiscord` are still tRPC only. The refresh runs on the refresh-operations queue as
the `clan-refresh` job from `jobs/clan-refresh-job.ts`.

1. The API sees a stale section, reserves a refresh operation and admits the caller.
2. The operations worker leases the operation. `prepareRefreshEffect` records the lease in `refresh_effects`.
3. `processRefreshClanSection` calls the source and publishes the section. If the lease was lost, the publish is
   fenced and writes nothing. If the fetch fails, the stored section stays and only the check is recorded. A
   retryable failure is also thrown back to the worker, which retries it.
4. Triggers write the change to `discovery_outbox`, and the worker delivers it through
   `createPostgresClanDiscoverySource`.
