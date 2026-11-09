# Modules

One folder per domain module, each a workspace package named `@brawltome/<name>`. How modules are loaded and migrated
is in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Layout

```text
<name>/
  index.ts        the one public surface, exports the <name>Module object
  README.md       what the module owns and what it needs from others
  domain/         types and rules, no database or HTTP code
  db/             queries and stores for the module's schema
  jobs/           background work the operations worker runs
  api/            what the module offers the API process (the router calls this)
  migrations/     one file per migration, plus the module's migration list
  tests/          tests for the module
```

Not every module needs every folder. Leave out the ones it has no use for.

## Rules

- `index.ts` is the only thing other packages may import. If something is exported from there, treat it as an API.
- A module reads and writes only its own schema. To use another module's data, call that module's exports.
- Migrations live in the module that owns the table. When one needs another module's table to exist first, list that
  migration's identity in `requires`.
- Tests go in `tests/` or in `*.test.ts` files. They are the only place that may import
  `@brawltome/foundation/testing`.

## Worked example

[`clan`](clan/README.md) is the first module on this layout. Copy its structure and its README when you rebuild
another one:

- `domain/` holds the rules, `db/` has the Drizzle tables and one file per use case, and `api/` has the oRPC procedures.
- `db/tables.ts` has every column of each table the code uses. Defaults, checks, indexes and triggers stay in the
  migrations. A table the code never touches can be left out.
- `tests/tables.test.ts` runs the drift check and the table-coverage check. `expectTablesMatchDatabase` compares
  each modelled table's columns, types and nullability with the migrated database, and the coverage check fails when
  a table in the schema is neither modelled nor on the test's list of unmodelled tables.
- `index.ts` is the only public surface. It also gives the module its `routes`.

## Modules that aren't rebuilt yet

A module that hasn't been rebuilt keeps its old layout. They all have `index.ts` and
`migrations/` already, and most have `tests/`; the rest of each folder is still arranged the way it grew. Only `clan`
and `queue` are rebuilt so far.

## Adding a background job

Each job lives in the module it belongs to, in that module's `jobs/`. [`queue`](queue/README.md) has the steps.
