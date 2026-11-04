const sql = `SET LOCAL lock_timeout = '5s';

CREATE TABLE discovery.semantic_migration_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE CHECK (operation_key <> '' AND length(operation_key) <= 256),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  source_evidence_hash char(64) NOT NULL CHECK (source_evidence_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('passed', 'blocked')),
  player_reconciliation_run_id uuid NOT NULL
    REFERENCES discovery.reconciliation_runs(run_id) ON DELETE RESTRICT,
  clan_reconciliation_run_id uuid NOT NULL
    REFERENCES discovery.reconciliation_runs(run_id) ON DELETE RESTRICT,
  player_source_version bigint NOT NULL CHECK (player_source_version >= 0),
  clan_source_version bigint NOT NULL CHECK (clan_source_version >= 0),
  player_projection_hash char(64) NOT NULL CHECK (player_projection_hash ~ '^[0-9a-f]{64}$'),
  clan_projection_hash char(64) NOT NULL CHECK (clan_projection_hash ~ '^[0-9a-f]{64}$'),
  fixture_hash char(64) NOT NULL CHECK (fixture_hash ~ '^[0-9a-f]{64}$'),
  fixture_count integer NOT NULL CHECK (fixture_count > 0 AND fixture_count <= 5000),
  fixture_manifest jsonb NOT NULL,
  intentional_difference_count integer NOT NULL CHECK (intentional_difference_count >= 0),
  unexplained_mismatch_count integer NOT NULL CHECK (unexplained_mismatch_count >= 0),
  mismatch_detail_count integer NOT NULL CHECK (mismatch_detail_count BETWEEN 0 AND 1000),
  mismatch_details_truncated boolean NOT NULL,
  mismatch_details jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'passed') = (unexplained_mismatch_count = 0)),
  CHECK (mismatch_detail_count = LEAST(unexplained_mismatch_count, 1000)),
  CHECK (mismatch_details_truncated = (unexplained_mismatch_count > 1000)),
  CHECK (jsonb_typeof(fixture_manifest) = 'array'),
  CHECK (jsonb_array_length(fixture_manifest) = fixture_count),
  CHECK (jsonb_typeof(mismatch_details) = 'array'),
  CHECK (jsonb_array_length(mismatch_details) = mismatch_detail_count)
);

CREATE FUNCTION discovery.reject_semantic_migration_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discovery semantic migration evidence is immutable';
END;
$$;
CREATE TRIGGER discovery_semantic_migration_runs_immutable
BEFORE UPDATE OR DELETE ON discovery.semantic_migration_runs
FOR EACH ROW EXECUTE FUNCTION discovery.reject_semantic_migration_evidence_mutation();
CREATE TRIGGER discovery_semantic_migration_runs_prevent_truncate
BEFORE TRUNCATE ON discovery.semantic_migration_runs
FOR EACH STATEMENT EXECUTE FUNCTION discovery.reject_semantic_migration_evidence_mutation();`

export const addSemanticMigrationEvidence = {
  identity: 'discovery/0003',
  predecessor: 'discovery/0002',
  checksum: 'f55522bd7ab481f5b062c7feecb0bc2bc3a308159c6be1c04a7222b680afb55e',
  sql,
} as const
