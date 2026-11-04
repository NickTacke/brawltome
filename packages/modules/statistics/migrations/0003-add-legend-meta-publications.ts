const sql = `CREATE TABLE statistics.legend_meta_publication_operations (
  generation_id uuid PRIMARY KEY REFERENCES statistics.cohort_generations(id),
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE statistics.legend_meta_publication_decisions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL UNIQUE REFERENCES statistics.legend_meta_publication_operations(generation_id),
  effect_operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  operation_key text NOT NULL UNIQUE,
  lease_token bigint NOT NULL CHECK (lease_token > 0),
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  artifact jsonb,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (decision = 'accepted' AND jsonb_typeof(artifact) = 'object' AND jsonb_array_length(reasons) = 0)
    OR (decision = 'rejected' AND artifact IS NULL AND jsonb_array_length(reasons) > 0)
  )
);

CREATE FUNCTION statistics.validate_legend_meta_publication_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM refresh_operations.operations operation
    WHERE operation.id = NEW.operation_id
      AND operation.effect_operation_id = operation.id
      AND operation.kind = 'statistics-legend-meta-publication'
      AND operation.operation_key = 'statistics:' || NEW.generation_id || ':legend-meta'
      AND operation.payload = jsonb_build_object('generationId', NEW.generation_id::text)
  ) THEN
    RAISE EXCEPTION 'Statistics Legend Meta publication operation identity conflicts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION statistics.validate_legend_meta_publication_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM statistics.legend_meta_publication_operations binding
    JOIN refresh_operations.operations operation
      ON operation.id = binding.operation_id AND operation.effect_operation_id = operation.id
    WHERE binding.generation_id = NEW.generation_id
      AND binding.operation_id = NEW.effect_operation_id
      AND operation.kind = 'statistics-legend-meta-publication'
      AND operation.operation_key = NEW.operation_key
      AND operation.payload = jsonb_build_object('generationId', NEW.generation_id::text)
  ) THEN
    RAISE EXCEPTION 'Statistics Legend Meta publication decision identity conflicts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER legend_meta_publication_operation_identity
BEFORE INSERT ON statistics.legend_meta_publication_operations
FOR EACH ROW EXECUTE FUNCTION statistics.validate_legend_meta_publication_operation();
CREATE TRIGGER legend_meta_publication_decision_identity
BEFORE INSERT ON statistics.legend_meta_publication_decisions
FOR EACH ROW EXECUTE FUNCTION statistics.validate_legend_meta_publication_decision();

CREATE TRIGGER legend_meta_publication_operations_immutable
BEFORE UPDATE OR DELETE ON statistics.legend_meta_publication_operations
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER legend_meta_publication_decisions_immutable
BEFORE UPDATE OR DELETE ON statistics.legend_meta_publication_decisions
FOR EACH ROW EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER legend_meta_publication_operations_truncate_immutable
BEFORE TRUNCATE ON statistics.legend_meta_publication_operations
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();
CREATE TRIGGER legend_meta_publication_decisions_truncate_immutable
BEFORE TRUNCATE ON statistics.legend_meta_publication_decisions
FOR EACH STATEMENT EXECUTE FUNCTION statistics.reject_immutable_change();`

export const addLegendMetaPublications = {
  identity: 'statistics/0003',
  predecessor: 'statistics/0002',
  checksum: '813076b897f733e20ac8041b1b3f7786fb6bf915e2804c06dbd0156d8477cb09',
  sql,
} as const
