# Analytics

Keeps the secret the api mixes into its daily visitor keys, so every api process uses the same one for a day. The
page view counting itself is in `apps/api/src/visits`.

## What it owns

The `analytics` schema, described in `db/tables.ts`:

- `daily_salts`: one row per UTC day, with that day's salt as 64 hex characters

The table is `UNLOGGED`, so the salt is never written to the write-ahead log. A Postgres crash empties the table. The
next page view then makes a new salt, and visitors who came back after the crash are counted twice that day.

A deleted row stays readable in the table's file until it is vacuumed. The table is set to be vacuumed after every
delete, so that is a minute or two, not the fifty deletes a table this small would otherwise wait for. Vacuum frees
the row, it doesn't wipe the bytes, so someone with root on the database host could still find a recent salt on disk.

## How a day's salt is made and removed

`saltFor(day)` does three things, in this order:

1. inserts a new random salt for the day unless the day already has one
2. deletes the salts of every day before it
3. reads the day's salt

Inserting before reading is what makes two processes agree: when both start the day together one insert wins, and
both read that row. Only older days are deleted, never later ones. Around midnight one process can be on the new day
while another is still on the old one, and the one behind must leave the new day's salt alone.

The other way round is not covered: a process that reads the old day for the first time in the same millisecond that
another one starts the new day can find its row deleted, or get a salt nobody else has. It takes a restart exactly
at midnight, the page view is dropped, and the next one reads again.

A salt is deleted by the first page view of a later day, so on a day without any page views the salt of the day
before stays until the next one comes.

Callers keep the salt in memory for the day. The api asks once per process per day.

A database backup taken during the day holds that day's row. The api therefore doesn't use the stored salt as it
is: it mixes it with a secret from its own environment (`apps/api/src/visits/server-bound-salt.ts`), so the table
alone can't recreate a day's keys.

The salt must never be logged, returned by a procedure or put in an error message. drizzle writes a failed query's
parameters into its error, so a failed insert is thrown again without them.

## Layout

- `db/`: `tables.ts`, `ensure-daily-salt.ts` for the use case and `postgres-daily-salts.ts`, which binds it to a database
- `migrations/`: creates the schema and the table
- `tests/`: the table check and the salt rules against Postgres

## Public surface

- `analyticsModule`: the module object (name and migrations)
- `createPostgresDailySalts`, for the api's visitor keys
