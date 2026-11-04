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

## Modules that aren't rebuilt yet

A module that hasn't been rebuilt keeps its old layout. They all have `index.ts` and
`migrations/` already, and most have `tests/`; the rest of each folder is still arranged the way it grew.
