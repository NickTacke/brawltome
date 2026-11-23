# Esports

Esports results for a player, taken from Brawltools: power rankings, tournament placements and the sets of each event.
The player page shows them in its esports section.

## What it owns

The `esports` schema, described in `db/tables.ts`:

- `players`: one row per player we asked Brawltools about. `link` is `linked` when Brawltools knows the account and
  `none` when it answered 404. It keeps the raw `{ earnings, pr }` of each mode, the legends played at events, and
  when the player was last checked and last refreshed with success
- `placements`: one row per player, mode (1 for 1v1, 2 for 2v2) and tournament, with the finish
- `event_sets`: the raw sets of one event for one player, kept so the shaping can change without asking again

## What it needs

- `queue`, to run its refresh jobs
- `player`, for the account an esports record belongs to

## Layout

- `api/`: the procedures the API serves. `read-player-esports.ts` answers the player page with the shaped profile,
  shown only when the link is trusted, and whether the stored data is due a refresh; `account-signals.ts` reads the
  account's names, top legends and region from the player module for the trust check
- `db/`: `tables.ts` and one file per read or write
- `domain/`: pure code, no I/O. `profile.ts` shapes the stored rows into the profile the player page shows,
  `event-names.ts` and `result-labels.ts` give each result a short title and meta line, `highlights.ts` picks the
  finishes the section leads with, `trust.ts` decides whether a Brawltools player really is the account it links to,
  `legend-keys.ts` lists the legends the site has art for, `refresh-timing.ts` holds how long stored data stays
  fresh, and `freshness.ts` decides from a player's row whether it is due a refresh
- `jobs/`: the two queue jobs. `esports-refresh` asks Brawltools for one player's power rankings, placements and
  event legends, and the sets of the events the highlight cards show. `esports-sets-backfill` fetches the sets of
  the player's other events. A 429 pauses the `brawltools` source and defers the job. Every other error counts a
  failed refresh, so the read backs off for a day. A 5xx or a request that never got an answer then completes the
  job; anything else still fails it, so it shows up in the dead letters
- `migrations/`: creates the schema and the tables
- `source/`: the Brawltools client and the raw response types
- `tests/`: the table check, the client, the domain code, the jobs and the read, with a few saved public Brawltools
  responses

## Public surface

- `esportsModule`: the module object (name, migrations and routes). Its one procedure, `esports.byPlayerId`, serves
  `GET /v1/players/{id}/esports` to internal callers
- `esportsRefreshContract`, `createEsportsRefreshJob`, `esportsSetsBackfillContract` and
  `createEsportsSetsBackfillJob`: the jobs, for the worker's job list. Nothing enqueues them yet
- `createBrawltoolsClient`: the client the worker builds the jobs around
- `linkedTtlMs`, `noneTtlMs` and `failureBackoffMs`: how long stored data stays fresh, for whoever enqueues a refresh
