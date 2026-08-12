const sql = `SET LOCAL lock_timeout = '5s';

CREATE TABLE players.legacy_profile_archive (
  brawlhalla_id integer PRIMARY KEY,
  raw_row jsonb NOT NULL,
  row_checksum char(64) NOT NULL CHECK (row_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER players_legacy_profile_archive_immutable
BEFORE UPDATE OR DELETE ON players.legacy_profile_archive
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_profile_archive_prevent_truncate
BEFORE TRUNCATE ON players.legacy_profile_archive
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TABLE players.legacy_profile_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  last_player_id integer,
  source_rows integer NOT NULL CHECK (source_rows >= 0),
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  block_reason jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE players.legacy_profile_import_ledger (
  brawlhalla_id integer PRIMARY KEY REFERENCES players.legacy_profile_archive(brawlhalla_id),
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('transformed', 'rejected')),
  transformed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER players_legacy_profile_ledger_immutable
BEFORE UPDATE OR DELETE ON players.legacy_profile_import_ledger
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_profile_ledger_prevent_truncate
BEFORE TRUNCATE ON players.legacy_profile_import_ledger
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TABLE players.legacy_profile_import_rejections (
  brawlhalla_id integer PRIMARY KEY REFERENCES players.legacy_profile_archive(brawlhalla_id),
  code text NOT NULL,
  evidence jsonb NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  rejected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER players_legacy_profile_rejections_immutable
BEFORE UPDATE OR DELETE ON players.legacy_profile_import_rejections
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_profile_rejections_prevent_truncate
BEFORE TRUNCATE ON players.legacy_profile_import_rejections
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();

CREATE TABLE players.legacy_profile_discovery (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text NOT NULL,
  rating integer CHECK (rating > 0),
  best_legend integer CHECK (best_legend > 0),
  observed_at timestamptz NOT NULL,
  archive_checksum char(64) NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER players_legacy_profile_discovery_immutable
BEFORE UPDATE OR DELETE ON players.legacy_profile_discovery
FOR EACH ROW EXECUTE FUNCTION players.prevent_legacy_archive_mutation();
CREATE TRIGGER players_legacy_profile_discovery_prevent_truncate
BEFORE TRUNCATE ON players.legacy_profile_discovery
FOR EACH STATEMENT EXECUTE FUNCTION players.prevent_legacy_archive_mutation();`

export const addLegacyBestLegend = {
  identity: 'players/0008',
  predecessor: 'players/0007',
  checksum: 'aad07a00fcabdb86da7c4d18eea9614ce9622ffbf71e878f14e07c4bbe454868',
  sql,
} as const
