# Analytics

Keeps the secret the api mixes into its daily visitor keys, so every api process uses the same one for a day. The
page view counting itself is in `apps/api/src/visits`.

## What it owns

The `analytics` schema, described in `db/tables.ts`:

- `daily_salts`: one row per UTC day, with that day's salt as 64 hex characters

The table is `UNLOGGED`, so the salt is never written to the write-ahead log. A Postgres crash empties the table. The
next page view then makes a new salt, and visitors who came back after the crash are counted twice that day.

## How a day's salt is made and removed

`saltFor(day)` does three things, in this order:

1. inserts a new random salt for the day unless the day already has one
2. deletes the salts of every day before it
3. reads the day's salt

Inserting before reading is what makes two processes agree: when both start the day together one insert wins, and
both read that row. Only older days are deleted, never later ones. Around midnight one process can be on the new day
while another is still on the old one, and the one behind must leave the new day's salt alone.

A salt is deleted by the first page view of a later day, so on a day without any page views the salt of the day
before stays until the next one comes.

Callers keep the salt in memory for the day. The api asks once per process per day.

The salt must never be logged, returned by a procedure or put in an error message. drizzle writes a failed query's
parameters into its error, so a failed insert is thrown again without them.

## Layout

- `db/`: `tables.ts`, `ensure-daily-salt.ts` for the use case and `postgres-daily-salts.ts`, which binds it to a database
- `migrations/`: creates the schema and the table
- `tests/`: the table check and the salt rules against Postgres

## Public surface

- `analyticsModule`: the module object (name and migrations)
- `createPostgresDailySalts` and the `PostgresDailySalts` type, for the api's visitor keys
