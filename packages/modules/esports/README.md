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

- `db/`: `tables.ts`
- `domain/`: pure code, no I/O. `profile.ts` shapes the stored rows into the profile the player page shows,
  `event-names.ts` and `result-labels.ts` give each result a short title and meta line, `trust.ts` decides whether a
  Brawltools player really is the account it links to, and `legend-keys.ts` lists the legends the site has art for
- `migrations/`: creates the schema and the tables
- `source/`: the Brawltools client and the raw response types
- `tests/`: the table check, the client and the domain code, with a few saved public Brawltools responses

## Public surface

- `esportsModule`: the module object (name, migrations and routes). It has no procedures yet.
