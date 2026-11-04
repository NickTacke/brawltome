const sql = `CREATE SCHEMA rankings;

CREATE TABLE rankings.generations (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  operation_key text NOT NULL UNIQUE,
  observed_at timestamptz NOT NULL,
  schedule_window_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expected_next_publication_at timestamptz NOT NULL,
  page_depth integer NOT NULL CHECK (page_depth BETWEEN 1 AND 20),
  source text NOT NULL CHECK (source = 'brawlhalla-v1-ranked-leaderboard'),
  source_contract_version integer NOT NULL CHECK (source_contract_version = 1),
  CHECK (expected_next_publication_at > schedule_window_at)
);
CREATE INDEX rankings_latest_generation ON rankings.generations (schedule_window_at DESC, id DESC);

CREATE TABLE rankings.snapshots (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL REFERENCES rankings.generations(id),
  scope text NOT NULL CHECK (scope IN ('all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  row_count integer NOT NULL CHECK (row_count > 0),
  UNIQUE (generation_id, scope)
);
CREATE INDEX rankings_snapshot_scope ON rankings.snapshots (scope, generation_id);

CREATE TABLE rankings.snapshot_rows (
  snapshot_id uuid NOT NULL REFERENCES rankings.snapshots(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  standing integer NOT NULL CHECK (standing > 0),
  source_rank integer NOT NULL CHECK (source_rank > 0),
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  name text NOT NULL CHECK (length(name) > 0),
  region text NOT NULL CHECK (region IN ('US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer CHECK (peak_rating >= 0),
  wins integer NOT NULL CHECK (wins >= 0),
  losses integer NOT NULL CHECK (losses >= 0),
  tier text,
  PRIMARY KEY (snapshot_id, ordinal),
  UNIQUE (snapshot_id, standing),
  UNIQUE (snapshot_id, brawlhalla_id),
  CHECK (peak_rating IS NULL OR peak_rating >= rating),
  CHECK ((wins::bigint + losses::bigint) <= 2147483647),
  CHECK (tier IS NULL OR length(tier) > 0)
);
CREATE INDEX rankings_snapshot_rows_standing ON rankings.snapshot_rows (snapshot_id, standing);

CREATE TABLE rankings.collection_failures (
  id uuid PRIMARY KEY,
  operation_key text NOT NULL,
  schedule_window_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rankings_latest_collection_failure
  ON rankings.collection_failures (schedule_window_at DESC, checked_at DESC, id DESC);

CREATE FUNCTION rankings.reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published ranking snapshots are immutable';
END;
$$;

CREATE TRIGGER generations_are_immutable
BEFORE UPDATE OR DELETE ON rankings.generations
FOR EACH ROW EXECUTE FUNCTION rankings.reject_immutable_change();
CREATE TRIGGER snapshots_are_immutable
BEFORE UPDATE OR DELETE ON rankings.snapshots
FOR EACH ROW EXECUTE FUNCTION rankings.reject_immutable_change();
CREATE TRIGGER snapshot_rows_are_immutable
BEFORE UPDATE OR DELETE ON rankings.snapshot_rows
FOR EACH ROW EXECUTE FUNCTION rankings.reject_immutable_change();`

export const initializeImmutable1v1Snapshots = {
  identity: 'rankings/0001',
  predecessor: null,
  checksum: 'd3c91ddf8a99e6a5a39b88eaad3813f9e65c693346fe1bf054b5fe6f4901b701',
  sql,
} as const
