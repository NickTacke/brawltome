const sql = `SET LOCAL lock_timeout = '5s';

CREATE TABLE players.legacy_archive (
  source_table text NOT NULL,
  source_key text NOT NULL,
  brawlhalla_id integer,
  raw_row jsonb NOT NULL,
  row_checksum char(64) NOT NULL CHECK (row_checksum ~ '^[0-9a-f]{64}$'),
  content_checksum char(64) NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key)
);

CREATE FUNCTION players.prevent_legacy_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Players legacy archive is immutable';
END;
$$;
CREATE TRIGGER players_legacy_archive_immutable
BEFORE UPDATE OR DELETE ON players.legacy_archive
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_archive_prevent_truncate
BEFORE TRUNCATE ON players.legacy_archive
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TABLE players.legacy_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  stage text NOT NULL CHECK (stage = 'players'),
  last_player_id integer,
  source_manifest jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE players.legacy_import_ledger (
  source_table text NOT NULL,
  source_key text NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('transformed', 'rejected')),
  transformed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key),
  FOREIGN KEY (source_table, source_key)
    REFERENCES players.legacy_archive(source_table, source_key)
);

CREATE TABLE players.legacy_facts (
  source_table text NOT NULL,
  source_key text NOT NULL,
  fact_key text NOT NULL,
  brawlhalla_id integer,
  scope text NOT NULL,
  source text NOT NULL CHECK (source = 'v2-legacy'),
  observed_at timestamptz,
  value jsonb,
  outcome text NOT NULL CHECK (outcome IN ('known', 'unknown')),
  reason text,
  provenance jsonb NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_table, source_key, fact_key),
  FOREIGN KEY (source_table, source_key)
    REFERENCES players.legacy_archive(source_table, source_key),
  CHECK ((outcome = 'known') = (value IS NOT NULL)),
  CHECK ((outcome = 'unknown') = (reason IS NOT NULL))
);
CREATE INDEX players_legacy_facts_player_scope
  ON players.legacy_facts (brawlhalla_id, scope, source_table, source_key);

CREATE TABLE players.legacy_import_rejections (
  source_table text NOT NULL,
  source_key text NOT NULL,
  code text NOT NULL,
  evidence jsonb NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  rejected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key, code)
);

CREATE TABLE players.legacy_discovery_profiles (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text NOT NULL,
  region text,
  rating integer CHECK (rating > 0),
  view_count integer NOT NULL CHECK (view_count >= 0),
  observed_at timestamptz NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$')
);

CREATE TABLE players.legacy_discovery_aliases (
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  normalized_alias text NOT NULL,
  display_alias text NOT NULL,
  observed_at timestamptz NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (brawlhalla_id, normalized_alias)
);

CREATE OR REPLACE FUNCTION players.enqueue_discovery_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  next_version bigint;
BEGIN
  IF current_setting('players.suppress_discovery_outbox', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE players.discovery_state
  SET source_version = source_version + 1
  WHERE singleton
  RETURNING source_version INTO next_version;

  INSERT INTO players.discovery_outbox (brawlhalla_id, source_version)
  VALUES (COALESCE(NEW.brawlhalla_id, OLD.brawlhalla_id), next_version);
  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER TABLE players.ranked_rating_history
  ADD COLUMN history_source text NOT NULL DEFAULT 'v0-player-snapshot',
  ADD COLUMN legacy_source_key text,
  ADD COLUMN source_order bigint,
  ADD CONSTRAINT players_ranked_history_legacy_provenance CHECK (
    (history_source = 'v0-player-snapshot' AND legacy_source_key IS NULL AND source_order IS NULL)
    OR
    (history_source = 'v2-legacy' AND legacy_source_key IS NOT NULL AND source_order IS NOT NULL)
  ) NOT VALID;

CREATE FUNCTION players.prevent_legacy_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.history_source = 'v2-legacy' THEN
    RAISE EXCEPTION 'Imported V2 rating history is immutable';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER players_legacy_history_immutable
BEFORE UPDATE OR DELETE ON players.ranked_rating_history
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_history_mutation();`

export const addV2PlayerImport = {
  identity: 'players/0007',
  predecessor: 'players/0006',
  checksum: 'b35628eb0f156eeef08460ee3b7771de160063fd0ca745a1d6aeb5690c4b03a9',
  sql,
} as const
