const sql = `ALTER TABLE players.career_profiles
  ADD COLUMN snapshot_source text NOT NULL DEFAULT 'v0-player-snapshot',
  ADD CONSTRAINT players_career_profiles_snapshot_source
    CHECK (snapshot_source IN ('v0-player-snapshot', 'legacy-v2')),
  ADD CONSTRAINT players_career_profiles_legacy_source_success
    CHECK (snapshot_source <> 'legacy-v2' OR last_success_at IS NOT NULL);

CREATE TABLE players.legacy_career_archive (
  brawlhalla_id integer PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER players_legacy_career_archive_immutable
BEFORE UPDATE OR DELETE ON players.legacy_career_archive
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_career_archive_prevent_truncate
BEFORE TRUNCATE ON players.legacy_career_archive
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TABLE players.legacy_career_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  last_player_id integer,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE players.legacy_career_import_rejections (
  brawlhalla_id integer PRIMARY KEY REFERENCES players.legacy_career_archive(brawlhalla_id),
  code text NOT NULL,
  evidence jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  rejected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER players_legacy_career_rejections_immutable
BEFORE UPDATE OR DELETE ON players.legacy_career_import_rejections
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_career_rejections_prevent_truncate
BEFORE TRUNCATE ON players.legacy_career_import_rejections
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();`

export const addHistoricalCareerSource = {
  identity: 'players/0012',
  predecessor: 'players/0011',
  checksum: '50cb7449d050561fbe44e4a1380f4db935ceb9baa1e39395a86818182aacd9aa',
  sql,
} as const
