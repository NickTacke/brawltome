const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE rankings.generations
  DROP CONSTRAINT generations_page_depth_check,
  DROP CONSTRAINT generations_source_check,
  DROP CONSTRAINT generations_source_contract_version_check;
ALTER TABLE rankings.generations ALTER COLUMN page_depth DROP NOT NULL;
ALTER TABLE rankings.generations
  ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT rankings_generation_source_check CHECK (
    (source = 'brawlhalla-v1-ranked-leaderboard' AND source_contract_version = 1
      AND page_depth BETWEEN 1 AND 20)
    OR
    (source = 'v2-legacy' AND source_contract_version = 1 AND page_depth IS NULL)
  );
UPDATE rankings.generations
SET provenance = jsonb_build_object(
  'source', source,
  'contractVersion', source_contract_version,
  'pageDepth', page_depth
);
ALTER TABLE rankings.generations
  ALTER COLUMN provenance DROP DEFAULT,
  ADD CONSTRAINT rankings_generation_provenance_check CHECK (
    provenance->>'source' = source
    AND (provenance->>'contractVersion')::integer = source_contract_version
  );

CREATE TABLE rankings.legacy_archive (
  source_table text NOT NULL,
  source_key text NOT NULL,
  raw_row jsonb NOT NULL,
  row_checksum char(64) NOT NULL CHECK (row_checksum ~ '^[0-9a-f]{64}$'),
  content_checksum char(64) NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_table, source_key)
);

CREATE TABLE rankings.legacy_import_progress (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status text NOT NULL CHECK (status IN ('in-progress', 'complete', 'blocked')),
  stage text NOT NULL CHECK (stage IN ('archive-player', 'archive-team', 'sets')),
  last_source_key text,
  last_mode text CHECK (last_mode IS NULL OR last_mode IN ('1v1', '2v2', 'solo2v2', '3v3')),
  source_manifest jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  block_reason jsonb,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL)),
  CHECK ((status = 'blocked') = (block_reason IS NOT NULL))
);

CREATE TABLE rankings.legacy_import_sets (
  mode text NOT NULL CHECK (mode IN ('1v1', '2v2', 'solo2v2', '3v3')),
  scope text NOT NULL CHECK (scope IN ('US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  status text NOT NULL CHECK (status IN ('accepted', 'rejected')),
  source_row_count integer NOT NULL CHECK (source_row_count >= 0),
  candidate_row_count integer NOT NULL CHECK (candidate_row_count >= 0),
  gates jsonb NOT NULL,
  reasons text[] NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  generation_id uuid REFERENCES rankings.generations(id),
  snapshot_id uuid REFERENCES rankings.snapshots(id),
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (mode, scope),
  CHECK ((status = 'accepted') = (cardinality(reasons) = 0)),
  CHECK ((status = 'accepted') = (generation_id IS NOT NULL AND snapshot_id IS NOT NULL))
);

CREATE TABLE rankings.legacy_set_sources (
  mode text NOT NULL,
  scope text NOT NULL,
  source_table text NOT NULL,
  source_key text NOT NULL,
  PRIMARY KEY (mode, scope, source_table, source_key),
  FOREIGN KEY (mode, scope) REFERENCES rankings.legacy_import_sets(mode, scope),
  FOREIGN KEY (source_table, source_key) REFERENCES rankings.legacy_archive(source_table, source_key)
);

CREATE FUNCTION rankings.reject_legacy_migration_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ranking legacy migration evidence is immutable';
END;
$$;
CREATE TRIGGER rankings_legacy_archive_immutable
BEFORE UPDATE OR DELETE ON rankings.legacy_archive
FOR EACH ROW EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();
CREATE TRIGGER rankings_legacy_archive_prevent_truncate
BEFORE TRUNCATE ON rankings.legacy_archive
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();
CREATE TRIGGER rankings_legacy_import_sets_immutable
BEFORE UPDATE OR DELETE ON rankings.legacy_import_sets
FOR EACH ROW EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();
CREATE TRIGGER rankings_legacy_import_sets_prevent_truncate
BEFORE TRUNCATE ON rankings.legacy_import_sets
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();
CREATE TRIGGER rankings_legacy_set_sources_immutable
BEFORE UPDATE OR DELETE ON rankings.legacy_set_sources
FOR EACH ROW EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();
CREATE TRIGGER rankings_legacy_set_sources_prevent_truncate
BEFORE TRUNCATE ON rankings.legacy_set_sources
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_legacy_migration_evidence_change();

CREATE TRIGGER rankings_generations_prevent_truncate
BEFORE TRUNCATE ON rankings.generations
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_immutable_change();
CREATE TRIGGER rankings_snapshots_prevent_truncate
BEFORE TRUNCATE ON rankings.snapshots
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_immutable_change();
CREATE TRIGGER rankings_snapshot_rows_prevent_truncate
BEFORE TRUNCATE ON rankings.snapshot_rows
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_immutable_change();`

export const addV2LegacyRankingImport = {
  identity: 'rankings/0003',
  predecessor: 'rankings/0002',
  checksum: 'eaa4c214adca89c9c694c6e802904b660a1d97f56d2515cc61b5cae003a87cbb',
  sql,
} as const
