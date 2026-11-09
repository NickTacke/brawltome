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
- `weekly_snapshot_runs`: one row per week the weekly snapshot job has started, and how far it got
- `weekly_snapshots`: each clan's guild points in each week

`db/tables.ts` has every column of each table the code uses, because `tests/tables.test.ts` compares each column
with the database. The migrations in `migrations/` own the defaults, checks, indexes and triggers.

The V2 import left `legacy_archive`, `legacy_import_progress`, `legacy_import_ledger`, `legacy_import_rejections` and
`import_conflicts` behind. They still exist but aren't modelled. They can be dropped in a later migration.

## Layout

- `domain/`: types and rules (parsing the source, provenance, publication results). No database code.
- `db/`: `tables.ts` and one file per use case, for example `get-clan-profile.ts` and `publish-roster.ts`.
  `postgres-clans.ts` binds them to a database.
- `api/`: `procedures.ts` holds the oRPC procedures. `read-clan-profile.ts`, `read-player-clan-membership.ts` and
  `read-ranked-clans.ts` call the `db/` use cases with the database and turn the result into the public shape.
  `clan-profile-contract.ts` does that mapping for a clan, so the tRPC refresh can map a clan it has already read.
- `jobs/`: `refresh-clan.ts` fetches a section from the source and publishes it. `clan-refresh-job.ts` is the queue
  job that runs it, section by section. `clan-refresh-reservation.ts` reserves and activates the queue operation.
  `clan-weekly-snapshot-job.ts` is the weekly snapshot job, and `clan-weekly-snapshot-schedule.ts` keeps its schedule.
  `weekly-snapshot-fetch.ts` fetches one guild with its retries, and `weekly-snapshot-failure.ts` decides what a failed
  attempt does.
- `tests/`: domain, table, refresh, discovery source and read-during-refresh tests.

## Public surface

Everything other packages may import is exported from `index.ts`, and only what something outside the module uses:

- `clanModule`: the module object (name, migrations and the oRPC procedures)
- `readClanProfile` and `readPlayerClanMembership`: the reads the tRPC adapters share with the oRPC procedures
- `toClanProfileContract`: turns a stored clan into its public shape, for the tRPC refresh
- `createPostgresClans` and the `ClanQueries` type: the old closure, for the refresh paths until the queue is replaced
- `createPostgresClanDiscoverySource`, for the operations worker
- `createClanRefreshJob`, for the operations worker's job list
- `createClanWeeklySnapshotJob`, `createPostgresWeeklySnapshots` and `reconcileClanWeeklySnapshotSchedule`, for the
  operations worker, and `clanWeeklySnapshotContract`, for the API's contract tests
- `createClanRefreshReservations`, for the tRPC clan refresh, and `reserveClanRefresh`, for the API's queue tests
- the `ClanProvenance` type, for the API's test fixtures

## oRPC procedures

| Procedure                   | HTTP                          | Returns                                                |
| --------------------------- | ----------------------------- | ------------------------------------------------------ |
| `clan.byId`                 | `GET /v1/clans/{id}`          | the clan profile, or null if never fetched             |
| `clan.membershipByPlayerId` | `GET /v1/players/{id}/clan`   | the player's clan id and name, or null                 |
| `clan.standingById`         | `GET /v1/clans/{id}/standing` | the clan's guild points and lifetime xp ranks, or null |
| `clan.rankedList`           | `GET /v1/clans?page=n`        | 30 stored clans per page, ranked by guild points       |

All four are also served at `/rpc/clan/*`. All four use `internalProcedure` from `@brawltome/foundation`, so they
need the internal secret.

`clan.rankedList` takes its rank over every clan with a profile, and a clan with no guild points comes last with no
rank. Its lifetime xp is the stored `clan_lifetime_xp`, which is the source's `xp` plus `legacy_xp`.

`clan.standingById` has no tRPC version. It ranks on the stored `clan_lifetime_xp`, the number `clan.byId` shows.

`apps/site` is the only caller of the oRPC versions so far, and it isn't serving traffic yet. The website's server
(the clan page, and the player page for the membership) and the Discord bot's `/clan` command still call the tRPC
versions in `apps/api/src/router/clan.router.ts`. Those call the same read functions, `readClanProfile` and
`readPlayerClanMembership`, so both routes return the same data.

## Refresh

`clan.refresh` and `clan.refreshDiscord` are still tRPC only. The refresh runs on the queue as the `clan-refresh`
job from `jobs/clan-refresh-job.ts`.

1. The API sees a stale section, reserves a refresh operation and admits the caller.
2. The operations worker leases the operation. `prepareRefreshEffect` records the lease in `refresh_effects`.
3. `processRefreshClanSection` calls the source and publishes the section. If the lease was lost, the publish is
   fenced and writes nothing. If the fetch fails, the stored section stays and only the check is recorded. A
   retryable failure is also thrown back to the worker, which retries it.
4. Triggers write the change to `discovery_outbox`, and the worker delivers it through
   `createPostgresClanDiscoverySource`.

## Weekly snapshot

The `clan-weekly-snapshot` job runs once a week in the maintenance work class. It fetches every stored clan's guild
stats from V1, in clan id order with a pause between calls, and does two things with each answer:

1. publishes the profile the same way a refresh does, so guild points and lifetime xp stay fresh for every clan
2. saves the clan's guild points in `weekly_snapshots`, under the day the schedule window came due, with the rank V1
   sent alongside them so the Last week rank can be checked against the game's

Both writes carry `trigger: 'weekly-snapshot'` in their provenance, so they can be told apart from a refresh. They
share one transaction with moving the run past the clan, and that transaction first checks the operation's lease with
the queue's `acquire_active_lease` fence. Marking or clearing an outage and finishing the week check it the same way. A
worker whose lease ran out while it waited on V1 writes nothing, so it can't overwrite the worker that took over.

The run row in `weekly_snapshot_runs` remembers the last clan, so a yield, a failed attempt or a lost lease carries on
after it. The job yields its slot after each slice of 100 clans. A failed call is retried in place twice, after 500 ms
and 2 s. A clan that still fails, or that the source answers with a 404 or with stats that don't parse, is skipped for
that week and gets a failed profile check, as a refresh records one. A failed clan is only skipped once a later clan
answers, so clans failing at the end of a slice are fetched again by the next one. Text holding U+0000, which Postgres
can't store, is saved without it.

When five clans in a row fail every retry, V1 is taken to be down: the run defers without spending an attempt and
picks up at the first of them. It doesn't pause V1, since that would hold every other caller. The run row notes when
that started in `source_down_since`, and a clan that answers clears it. After 6 hours each defer also skips the first
of the failing clans, so five broken clans in a row cost the week 6 hours, and an outage that lasts longer loses one
clan per defer. A 429 or a source admission limit also defers. A failure of admission
itself is a database error, so it takes the normal retries. Once every clan is done the week gets a `completed_at`.

A week stops once the next weekly window is due, even if it never finished, and so does a dead letter of it replayed
after that, since a replay keeps its window. The points V1 sends by then belong to the next week, so saving them
under this one would leave Last week near zero. The job finishes the operation without fetching and leaves the week
without a `completed_at`, which Last week reads as no figure.

Last week is the latest completed week's points minus the points of the week seven days before it, which must have
completed too, so the first figure appears a week after the second run. A clan whose points went down gets no figure,
since that isn't a week of earned points. No clan gets one once the latest completed week is more than 14 days old.
`clan.standingById` serves it as `lastWeekPoints`, with its rank among the clans that have a figure as `lastWeekRank`.
