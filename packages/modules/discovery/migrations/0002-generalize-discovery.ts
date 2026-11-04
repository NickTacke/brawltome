const sql = `CREATE TABLE discovery.generations (
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'clan')),
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  built_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_version bigint NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  active boolean NOT NULL DEFAULT false,
  PRIMARY KEY (entity_kind, generation_id)
);
CREATE UNIQUE INDEX discovery_one_active_generation
  ON discovery.generations (entity_kind) WHERE active;

CREATE TABLE discovery.terms (
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'clan')),
  generation_id uuid NOT NULL,
  entity_id integer NOT NULL CHECK (entity_id > 0),
  term_kind text NOT NULL CHECK (term_kind IN ('canonical', 'segment', 'alias')),
  display_term text NOT NULL,
  normalized_term text COLLATE "C" NOT NULL,
  canonical_name text NOT NULL,
  region text,
  rating integer,
  view_count integer,
  best_legend_name_key text,
  clan_xp numeric(40, 0),
  member_count integer,
  PRIMARY KEY (entity_kind, generation_id, entity_id, term_kind, normalized_term),
  FOREIGN KEY (entity_kind, generation_id)
    REFERENCES discovery.generations(entity_kind, generation_id) ON DELETE CASCADE,
  CHECK (rating IS NULL OR rating >= 0),
  CHECK (
    (entity_kind = 'player'
      AND view_count IS NOT NULL AND view_count >= 0
      AND clan_xp IS NULL AND member_count IS NULL)
    OR
    (entity_kind = 'clan'
      AND term_kind = 'canonical'
      AND region IS NULL AND rating IS NULL AND view_count IS NULL AND best_legend_name_key IS NULL
      AND clan_xp IS NOT NULL AND clan_xp >= 0
      AND member_count IS NOT NULL AND member_count >= 0)
  )
);
CREATE INDEX discovery_terms_prefix
  ON discovery.terms (entity_kind, generation_id, normalized_term);

CREATE TABLE discovery.event_receipts (
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'clan')),
  event_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (entity_kind, event_id)
);

CREATE TABLE discovery.projection_effects (
  operation_id uuid PRIMARY KEY,
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'clan')),
  source_version bigint NOT NULL CHECK (source_version >= 0),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz
);

CREATE TABLE discovery.reconciliation_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid,
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'clan')),
  observed_source_version bigint NOT NULL CHECK (observed_source_version >= 0),
  projected_version_before bigint NOT NULL CHECK (projected_version_before >= 0),
  projected_version_after bigint NOT NULL CHECK (projected_version_after >= 0),
  source_fact_count integer NOT NULL CHECK (source_fact_count >= 0),
  projected_fact_count_before integer NOT NULL CHECK (projected_fact_count_before >= 0),
  projected_fact_count_after integer NOT NULL CHECK (projected_fact_count_after >= 0),
  pending_event_count integer NOT NULL CHECK (pending_event_count >= 0),
  oldest_pending_at timestamptz,
  expected_hash text NOT NULL CHECK (length(expected_hash) = 64),
  projected_hash_before text NOT NULL CHECK (length(projected_hash_before) = 64),
  projected_hash_after text NOT NULL CHECK (length(projected_hash_after) = 64),
  exact_before boolean NOT NULL,
  exact_after boolean NOT NULL,
  repaired boolean NOT NULL,
  difference_count integer NOT NULL CHECK (difference_count >= 0),
  difference_details_truncated boolean NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operation_id)
);

CREATE TABLE discovery.reconciliation_differences (
  run_id uuid NOT NULL REFERENCES discovery.reconciliation_runs(run_id) ON DELETE RESTRICT,
  entity_id integer NOT NULL CHECK (entity_id > 0),
  difference_kind text NOT NULL CHECK (difference_kind IN ('missing', 'unexpected', 'mismatched')),
  expected_fact jsonb,
  projected_fact jsonb,
  PRIMARY KEY (run_id, entity_id)
);

CREATE FUNCTION discovery.reject_reconciliation_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'discovery reconciliation evidence is immutable';
END;
$$;
CREATE TRIGGER discovery_reconciliation_runs_immutable
BEFORE UPDATE OR DELETE ON discovery.reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION discovery.reject_reconciliation_evidence_mutation();
CREATE TRIGGER discovery_reconciliation_runs_truncate_immutable
BEFORE TRUNCATE ON discovery.reconciliation_runs
FOR EACH STATEMENT EXECUTE FUNCTION discovery.reject_reconciliation_evidence_mutation();
CREATE TRIGGER discovery_reconciliation_differences_immutable
BEFORE UPDATE OR DELETE ON discovery.reconciliation_differences
FOR EACH ROW EXECUTE FUNCTION discovery.reject_reconciliation_evidence_mutation();
CREATE TRIGGER discovery_reconciliation_differences_truncate_immutable
BEFORE TRUNCATE ON discovery.reconciliation_differences
FOR EACH STATEMENT EXECUTE FUNCTION discovery.reject_reconciliation_evidence_mutation();

INSERT INTO discovery.generations
  (entity_kind, generation_id, built_at, source_version, active)
SELECT 'player', generation_id, built_at, source_version, active
FROM discovery.player_generations;

INSERT INTO discovery.terms
  (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
   canonical_name, region, rating, view_count, best_legend_name_key)
SELECT 'player', generation_id, brawlhalla_id, term_kind, display_term, normalized_term,
       canonical_name, region, rating, view_count, best_legend_name_key
FROM discovery.player_terms;

INSERT INTO discovery.event_receipts (entity_kind, event_id, applied_at)
SELECT 'player', event_id, applied_at FROM discovery.player_event_receipts;

INSERT INTO discovery.projection_effects
  (operation_id, entity_kind, source_version, applied_at, acknowledged_at)
SELECT operation_id, 'player', source_version, applied_at, acknowledged_at
FROM discovery.player_projection_effects;

INSERT INTO discovery.generations (entity_kind, active) VALUES ('clan', true);`

export const generalizeDiscovery = {
  identity: 'discovery/0002',
  predecessor: 'discovery/0001',
  checksum: '4c220d9f563c8164f4d4a38c2eb910f554a050eac2f11fc7222b24da33c45a42',
  sql,
} as const
