const sql = `CREATE TABLE statistics.cohort_generations (
  id uuid PRIMARY KEY,
  methodology_version text NOT NULL CHECK (length(methodology_version) BETWEEN 1 AND 200),
  source_generation_id uuid NOT NULL,
  source_observed_at timestamptz NOT NULL,
  observation_window_starts_at timestamptz NOT NULL,
  observation_window_ends_at timestamptz NOT NULL,
  source_domain text NOT NULL CHECK (source_domain = 'brawlhalla-v1'),
  quota_units_per_window integer NOT NULL CHECK (quota_units_per_window = 150),
  quota_window_seconds integer NOT NULL CHECK (quota_window_seconds = 900),
  requests_per_player integer NOT NULL CHECK (requests_per_player = 2),
  max_attempts_per_request integer NOT NULL CHECK (max_attempts_per_request = 3),
  selected_players integer NOT NULL CHECK (selected_players BETWEEN 0 AND 13500),
  planned_requests integer NOT NULL CHECK (planned_requests BETWEEN 0 AND 27000),
  maximum_source_attempts integer NOT NULL CHECK (maximum_source_attempts BETWEEN 0 AND 81000),
  minimum_capacity_seconds integer NOT NULL CHECK (minimum_capacity_seconds BETWEEN 0 AND 486000),
  observation_window_seconds integer NOT NULL CHECK (observation_window_seconds = 604800),
  evidence_state text NOT NULL CHECK (evidence_state IN ('ready', 'insufficient-evidence')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (methodology_version, source_generation_id),
  CHECK (observation_window_ends_at = observation_window_starts_at + interval '7 days'),
  CHECK (planned_requests = selected_players * requests_per_player),
  CHECK (maximum_source_attempts = planned_requests * max_attempts_per_request),
  CHECK (minimum_capacity_seconds = ((maximum_source_attempts + 149) / 150) * 900)
);

ALTER TABLE statistics.cohorts
  ADD COLUMN generation_id uuid REFERENCES statistics.cohort_generations(id),
  DROP CONSTRAINT cohorts_tracer_key_check,
  DROP CONSTRAINT cohorts_region_check,
  DROP CONSTRAINT cohorts_bracket_check,
  DROP CONSTRAINT cohorts_methodology_version_key,
  ADD CONSTRAINT cohorts_tracer_key_check CHECK (length(tracer_key) BETWEEN 1 AND 300),
  ADD CONSTRAINT cohorts_region_check CHECK (region IN ('US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  ADD CONSTRAINT cohorts_bracket_check CHECK (bracket IN ('Platinum', 'Diamond+')),
  ADD CONSTRAINT cohorts_generation_shape CHECK (
    generation_id IS NOT NULL
    OR (tracer_key = 'eu-diamond-plus' AND region = 'EU' AND bracket = 'Diamond+')
  );

CREATE UNIQUE INDEX cohorts_generation_cell
  ON statistics.cohorts (generation_id, region, bracket)
  WHERE generation_id IS NOT NULL;

ALTER TABLE statistics.cohort_members
  DROP CONSTRAINT cohort_members_source_rating_check,
  ADD CONSTRAINT cohort_members_source_rating_check CHECK (source_rating >= 1680);

CREATE TABLE statistics.collection_attempts (
  cohort_id uuid NOT NULL,
  brawlhalla_id bigint NOT NULL,
  product text NOT NULL CHECK (product IN ('ranked', 'lifetime')),
  operation_id uuid NOT NULL,
  effect_operation_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  lease_token bigint NOT NULL CHECK (lease_token > 0),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, attempt_number),
  FOREIGN KEY (cohort_id, brawlhalla_id, product)
    REFERENCES statistics.collection_operations(cohort_id, brawlhalla_id, product),
  FOREIGN KEY (operation_id) REFERENCES refresh_operations.operations(id),
  FOREIGN KEY (effect_operation_id) REFERENCES refresh_operations.operations(id)
);

CREATE INDEX collection_attempts_progress
  ON statistics.collection_attempts (cohort_id, brawlhalla_id, product, attempted_at);

CREATE TABLE statistics.publication_operations (
  generation_id uuid NOT NULL REFERENCES statistics.cohort_generations(id),
  product text NOT NULL CHECK (product IN ('ranked', 'lifetime')),
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (generation_id, product)
);

CREATE TABLE statistics.publication_decisions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL,
  product text NOT NULL CHECK (product IN ('ranked', 'lifetime')),
  effect_operation_id uuid NOT NULL UNIQUE,
  operation_key text NOT NULL UNIQUE,
  lease_token bigint NOT NULL CHECK (lease_token > 0),
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  progress jsonb NOT NULL CHECK (jsonb_typeof(progress) = 'object'),
  observation_window jsonb NOT NULL CHECK (jsonb_typeof(observation_window) = 'object'),
  capacity_envelope jsonb NOT NULL CHECK (jsonb_typeof(capacity_envelope) = 'object'),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (generation_id, product),
  FOREIGN KEY (generation_id, product)
    REFERENCES statistics.publication_operations(generation_id, product),
  FOREIGN KEY (effect_operation_id) REFERENCES refresh_operations.operations(id)
);

CREATE FUNCTION statistics.validate_collection_attempt_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM refresh_operations.operations delivered
    JOIN refresh_operations.operations root
      ON root.id = delivered.effect_operation_id AND root.effect_operation_id = root.id
    JOIN statistics.collection_operations binding
      ON binding.operation_id = root.id
     AND binding.cohort_id = NEW.cohort_id
     AND binding.brawlhalla_id = NEW.brawlhalla_id
     AND binding.product = NEW.product
    WHERE delivered.id = NEW.operation_id
      AND root.id = NEW.effect_operation_id
      AND delivered.kind = CASE NEW.product
        WHEN 'ranked' THEN 'statistics-ranked-collection'
        ELSE 'statistics-lifetime-collection'
      END
      AND delivered.operation_key = 'statistics:' || NEW.cohort_id || ':' || NEW.brawlhalla_id || ':' || NEW.product
      AND delivered.payload->>'cohortId' = NEW.cohort_id::text
      AND delivered.payload->>'brawlhallaId' = NEW.brawlhalla_id::text
  ) THEN
    RAISE EXCEPTION 'Statistics collection attempt operation identity conflicts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION statistics.validate_publication_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM refresh_operations.operations operation
    WHERE operation.id = NEW.operation_id
      AND operation.effect_operation_id = operation.id
      AND operation.kind = 'statistics-publication'
      AND operation.operation_key = 'statistics:' || NEW.generation_id || ':publication:' || NEW.product
      AND operation.payload->>'generationId' = NEW.generation_id::text
      AND operation.payload->>'product' = NEW.product
  ) THEN
    RAISE EXCEPTION 'Statistics publication operation identity conflicts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION statistics.validate_publication_decision_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM statistics.publication_operations binding
    JOIN refresh_operations.operations operation
      ON operation.id = binding.operation_id AND operation.effect_operation_id = operation.id
    WHERE binding.generation_id = NEW.generation_id
      AND binding.product = NEW.product
      AND binding.operation_id = NEW.effect_operation_id
      AND operation.kind = 'statistics-publication'
      AND operation.operation_key = NEW.operation_key
      AND operation.payload->>'generationId' = NEW.generation_id::text
      AND operation.payload->>'product' = NEW.product
  ) THEN
    RAISE EXCEPTION 'Statistics publication decision operation identity conflicts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_attempt_operation_identity
BEFORE INSERT ON statistics.collection_attempts
FOR EACH ROW EXECUTE FUNCTION statistics.validate_collection_attempt_operation();
CREATE TRIGGER publication_operation_identity
BEFORE INSERT ON statistics.publication_operations
FOR EACH ROW EXECUTE FUNCTION statistics.validate_publication_operation();
CREATE TRIGGER publication_decision_operation_identity
BEFORE INSERT ON statistics.publication_decisions
FOR EACH ROW EXECUTE FUNCTION statistics.validate_publication_decision_operation();

CREATE TRIGGER cohort_generations_immutable
BEFORE UPDATE OR DELETE ON statistics.cohort_generations
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER collection_attempts_immutable
BEFORE UPDATE OR DELETE ON statistics.collection_attempts
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER publication_operations_immutable
BEFORE UPDATE OR DELETE ON statistics.publication_operations
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER publication_decisions_immutable
BEFORE UPDATE OR DELETE ON statistics.publication_decisions
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER cohort_generations_truncate_immutable
BEFORE TRUNCATE ON statistics.cohort_generations
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER collection_attempts_truncate_immutable
BEFORE TRUNCATE ON statistics.collection_attempts
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER publication_operations_truncate_immutable
BEFORE TRUNCATE ON statistics.publication_operations
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER publication_decisions_truncate_immutable
BEFORE TRUNCATE ON statistics.publication_decisions
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();`

export const addFullLaunchCohort = {
  identity: 'statistics/0002',
  predecessor: 'statistics/0001',
  checksum: '3db34be5ecdd4efba562ff08e4ea4481916f6c531b0626df00ee42ec029bd053',
  sql,
} as const
