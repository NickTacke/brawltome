# Match insights

Works out everything the match page shows from a stored bh-native line: the game's counters per player, openings and
punishes, moments and how they began, KOs, habits, neutral, stocks, the lead over the match, review stops and the
match drawn on its stage. The API calls it after a parse and serves the result; the site only renders it.

## What it owns

Nothing stored. It is a set of pure functions with no tables, routes, jobs or migrations, so it isn't in the API's,
the worker's or the migration runner's module lists. The shape it returns, `MatchInsights`, is in
`@brawltome/contracts`, as is `LevelLayout`, the map layout it takes.

## Using it

```ts
import { INSIGHTS_VERSION, isInsightMatch, readMatchInsights } from '@brawltome/match-insights'

const insights = readMatchInsights(line, layout) // layout: LevelLayout | null
```

- `isInsightMatch(line)` is true for a format 1 line of a stock 1v1 or 2v2 that has a timeline.
- `readMatchInsights(line, layout)` returns null for any other line, and throws when the line says it is one but its
  timeline isn't the shape format 1 promises. Without a layout the stage box is traced from where players stood and no
  platforms are drawn.
- `INSIGHTS_VERSION` goes up whenever a figure is worked out differently, so stored insights can be worked out again.

## Layout

- `src/line.ts`: the typed view of a line the analysis reads. Events of an unknown type are left out.
- `src/record.ts`, `src/series.ts`, `src/positions.ts`, `src/events.ts`: reading the line once, and the state change
  lists, positions and events in it.
- `src/strikes.ts`, `src/blows.ts`, `src/punishes.ts`, `src/punish-cause.ts`, `src/facts.ts`: swings and throws, what
  each did to each target, and the punishes they add up to.
- `src/habits/`: one file per kind of habit.
- `src/stage/`: the stage box, the map layout in it, the marks on it and the playback.
- `src/read-match-insights.ts`: puts it all together.

## Tests

`bun test packages/modules/match-insights` runs every figure over four anonymised matches in `tests/fixtures/` (two
1v1s, two 2v2s). The expected numbers come from `tests/derive*.ts`, which work them out again straight from the raw
events, state and the game's own counters without importing `src/`.

The site can't import this module, so its tests read the same four matches' insights from
`apps/site/tests/fixtures/*.insights.json`. `tests/site-fixtures.test.ts` fails when those files are stale; write them
again with `bun run write-site-fixtures` in this folder.
