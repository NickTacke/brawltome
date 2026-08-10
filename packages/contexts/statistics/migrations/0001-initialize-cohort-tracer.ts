const sql = `CREATE SCHEMA statistics;

CREATE TABLE statistics.cohorts (
  id uuid PRIMARY KEY,
  tracer_key text NOT NULL UNIQUE CHECK (tracer_key = 'eu-diamond-plus'),
  methodology_version text NOT NULL CHECK (length(methodology_version) BETWEEN 1 AND 200),
  source_snapshot_id uuid NOT NULL,
  source_generation_id uuid NOT NULL,
  source_observed_at timestamptz NOT NULL,
  region text NOT NULL CHECK (region = 'EU'),
  bracket text NOT NULL CHECK (bracket = 'Diamond+'),
  sample_cap integer NOT NULL CHECK (sample_cap = 750),
  minimum_evidence_players integer NOT NULL CHECK (minimum_evidence_players = 125),
  eligible_players integer NOT NULL CHECK (eligible_players >= 0),
  selected_players integer NOT NULL CHECK (selected_players BETWEEN 0 AND 750),
  evidence_state text NOT NULL CHECK (evidence_state IN ('ready', 'insufficient-evidence')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((evidence_state = 'ready') = (selected_players >= minimum_evidence_players)),
  UNIQUE (methodology_version)
);

CREATE TABLE statistics.cohort_members (
  cohort_id uuid NOT NULL REFERENCES statistics.cohorts(id),
  brawlhalla_id bigint NOT NULL CHECK (brawlhalla_id > 0),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 750),
  source_rating integer NOT NULL CHECK (source_rating >= 2000),
  selection_hash text NOT NULL CHECK (selection_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (cohort_id, brawlhalla_id),
  UNIQUE (cohort_id, ordinal),
  UNIQUE (cohort_id, selection_hash)
);

CREATE TABLE statistics.collection_operations (
  cohort_id uuid NOT NULL,
  brawlhalla_id bigint NOT NULL,
  product text NOT NULL CHECK (product IN ('ranked', 'lifetime')),
  operation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cohort_id, brawlhalla_id, product),
  FOREIGN KEY (cohort_id, brawlhalla_id)
    REFERENCES statistics.cohort_members(cohort_id, brawlhalla_id)
);

CREATE TABLE statistics.observations (
  cohort_id uuid NOT NULL,
  brawlhalla_id bigint NOT NULL,
  product text NOT NULL CHECK (product IN ('ranked', 'lifetime')),
  effect_operation_id uuid NOT NULL UNIQUE,
  operation_key text NOT NULL UNIQUE,
  lease_token bigint NOT NULL,
  observed_at timestamptz NOT NULL,
  evidence_version integer NOT NULL CHECK (evidence_version = 1),
  evidence jsonb NOT NULL,
  PRIMARY KEY (cohort_id, brawlhalla_id, product),
  FOREIGN KEY (cohort_id, brawlhalla_id, product)
    REFERENCES statistics.collection_operations(cohort_id, brawlhalla_id, product)
);

CREATE FUNCTION statistics.reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'statistics cohort evidence is immutable';
END;
$$;

CREATE TRIGGER cohorts_immutable BEFORE UPDATE OR DELETE ON statistics.cohorts
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER cohort_members_immutable BEFORE UPDATE OR DELETE ON statistics.cohort_members
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER collection_operations_immutable BEFORE UPDATE OR DELETE ON statistics.collection_operations
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER observations_immutable BEFORE UPDATE OR DELETE ON statistics.observations
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER cohorts_truncate_immutable BEFORE TRUNCATE ON statistics.cohorts
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER cohort_members_truncate_immutable BEFORE TRUNCATE ON statistics.cohort_members
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER collection_operations_truncate_immutable BEFORE TRUNCATE ON statistics.collection_operations
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER observations_truncate_immutable BEFORE TRUNCATE ON statistics.observations
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();`

export const initializeStatisticsCohortTracer = {
  identity: 'statistics/0001',
  predecessor: null,
  checksum: '3eaeb7aeeffdcd02b673cc8ec595f7008be756d330db0aaf4427ebb3511c4298',
  sql,
} as const
