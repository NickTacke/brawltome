// the art the replay worker exports for each match, kept in the public art bucket. new tables and new columns with
// defaults only, so the release still serving during a deploy keeps working
const sql = `ALTER TABLE replays.matches
  ADD COLUMN art_state varchar(8) NOT NULL DEFAULT 'none'
    CHECK (art_state IN ('none', 'queued', 'ready', 'failed')),
  -- room for a 64-character build and a lease token in the key
  ADD COLUMN art_manifest_key varchar(200),
  ADD COLUMN art_format smallint,
  ADD COLUMN art_failure jsonb,
  ADD CHECK ((art_state = 'failed') = (art_failure IS NOT NULL)),
  ADD CHECK (art_state <> 'ready' OR art_manifest_key IS NOT NULL);

-- a match job exports one match's art; a warm job exports a patch's maps and default looks ahead of matches
CREATE TABLE replays.art_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(8) NOT NULL CHECK (kind IN ('match', 'warm')),
  match_id uuid REFERENCES replays.matches(id),
  patch varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  -- the line the worker was handed, so art for a line a re-parse has since replaced is refused
  timeline_key varchar(200),
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'match') = (match_id IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL)),
  CHECK ((status = 'failed') = (failure IS NOT NULL))
);

CREATE UNIQUE INDEX replays_art_jobs_one_active_idx
  ON replays.art_jobs (kind, (coalesce(match_id::text, patch))) WHERE status IN ('pending', 'processing');
-- every worker report asks whether each of its patches was ever warmed
CREATE INDEX replays_art_jobs_warm_patch_idx ON replays.art_jobs (patch) WHERE kind = 'warm';

-- every file the art bucket holds; they are named by their content or their inputs, so a stored path never changes.
-- one upload attempt claims a path before its bytes go to the bucket, and holds it while its job's lease runs
CREATE TABLE replays.art_files (
  path varchar(80) PRIMARY KEY,
  bytes integer NOT NULL CHECK (bytes >= 0),
  state varchar(9) NOT NULL CHECK (state IN ('uploading', 'stored')),
  job_id uuid,
  lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'uploading') = (lease_token IS NOT NULL)),
  CHECK ((job_id IS NULL) = (lease_token IS NULL))
);

-- the map file (maps/<fingerprint>.json) a patch draws each map with
CREATE TABLE replays.map_files (
  patch varchar(16) NOT NULL,
  map_id integer NOT NULL,
  path varchar(80) NOT NULL,
  PRIMARY KEY (patch, map_id)
);

-- the export formats the worker has reported; a new one re-exports the matches drawn in another
CREATE TABLE replays.art_formats (
  format smallint PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`

export const addArt = {
  identity: 'replays/0003',
  predecessor: 'replays/0002',
  checksum: '986f0da0691942e748dd4adb05a520164cf64ed978ef29a46875df631977c26a',
  requires: [],
  sql,
} as const
