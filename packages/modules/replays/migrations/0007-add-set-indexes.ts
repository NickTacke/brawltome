// pre-drawn sets: a predraw job draws a patch's sets and its set index once, and the index's path is kept per patch.
// a match job of a patch with an index names its sets instead of drawing its players, and waits while the art bucket
// lacks one. a new table and a new nullable column, and the kind check widened to the new job kind, so the release
// still serving during a deploy keeps working: it never writes a predraw job or a wait
const sql = `ALTER TABLE replays.art_jobs
  DROP CONSTRAINT art_jobs_kind_check,
  ADD CONSTRAINT art_jobs_kind_check CHECK (kind IN ('match', 'warm', 'predraw')),
  -- a job waiting for its patch's sets isn't claimed again before this
  ADD COLUMN wait_until timestamptz;

-- the set index (sets/<sha256>.json) of each patch whose sets are all in the art bucket
CREATE TABLE replays.set_indexes (
  patch varchar(16) PRIMARY KEY,
  path varchar(80) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`

export const addSetIndexes = {
  identity: 'replays/0007',
  predecessor: 'replays/0006',
  checksum: 'd03296d4ad67d3408510b09aa5bf14ead7b5cfe9fd10712ef4f9e5f28aa2b19e',
  requires: [],
  sql,
} as const
