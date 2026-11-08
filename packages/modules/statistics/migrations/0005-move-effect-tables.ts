// statistics effects and collection seals move to their owner; the release still serving and a rollback to it keep the
// old names through views and wrapper functions until a later release drops them. the tables lock access exclusive,
// publication effects before collection seals, because the publication record function reads them in that order and
// a worker part way through it must be able to finish while the migration waits. nothing here locks
// refresh_operations.operations, and the record and seal functions are recreated because plpgsql stores the old schema
// as text
const sql = `SET LOCAL lock_timeout = '5s';

LOCK TABLE
  refresh_operations.statistics_publication_effects,
  refresh_operations.statistics_collection_seals,
  refresh_operations.statistics_legend_meta_publication_effects,
  refresh_operations.statistics_collection_effects
IN ACCESS EXCLUSIVE MODE;

ALTER TABLE refresh_operations.statistics_publication_effects SET SCHEMA statistics;
ALTER TABLE refresh_operations.statistics_collection_seals SET SCHEMA statistics;
ALTER TABLE refresh_operations.statistics_legend_meta_publication_effects SET SCHEMA statistics;
ALTER TABLE refresh_operations.statistics_collection_effects SET SCHEMA statistics;

CREATE VIEW refresh_operations.statistics_collection_effects AS
  SELECT operation_key, operation_id, kind, lease_token, created_at FROM statistics.statistics_collection_effects;
CREATE VIEW refresh_operations.statistics_publication_effects AS
  SELECT operation_key, operation_id, lease_token, created_at FROM statistics.statistics_publication_effects;
CREATE VIEW refresh_operations.statistics_legend_meta_publication_effects AS
  SELECT operation_key, operation_id, lease_token, created_at
  FROM statistics.statistics_legend_meta_publication_effects;
CREATE VIEW refresh_operations.statistics_collection_seals AS
  SELECT collection_operation_id, publication_operation_id, created_at FROM statistics.statistics_collection_seals;

ALTER FUNCTION refresh_operations.record_statistics_collection_effect(uuid, text, text, text, bigint)
  SET SCHEMA statistics;
ALTER FUNCTION refresh_operations.seal_statistics_collections_for_publication(uuid, uuid[]) SET SCHEMA statistics;
ALTER FUNCTION refresh_operations.record_statistics_publication_effect(uuid, text, text, bigint, uuid[])
  SET SCHEMA statistics;
ALTER FUNCTION refresh_operations.record_statistics_legend_meta_publication_effect(uuid, text, text, bigint)
  SET SCHEMA statistics;

CREATE OR REPLACE FUNCTION statistics.record_statistics_collection_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing statistics.statistics_collection_effects%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('statistics-ranked-collection', 'statistics-lifetime-collection') THEN
    RETURN 'effect-conflict';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 209));
  SELECT * INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  SELECT * INTO existing
  FROM statistics.statistics_collection_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = active.effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = active.effect_operation_id
      AND existing.operation_key = p_operation_key
      AND existing.kind = p_kind THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  IF active.id IS NULL
    OR active.kind <> p_kind
    OR active.operation_key <> p_operation_key
    OR active.status <> 'leased'
    OR active.lease_owner <> p_lease_owner
    OR active.lease_token <> p_lease_token
    OR active.lease_expires_at <= clock_timestamp() THEN
    RETURN 'lease-lost';
  END IF;

  INSERT INTO statistics.statistics_collection_effects
    (operation_key, operation_id, kind, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_kind, p_lease_token);
  RETURN 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION statistics.seal_statistics_collections_for_publication(
  p_publication_operation_id uuid,
  p_collection_operation_ids uuid[]
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  publication refresh_operations.operations%ROWTYPE;
  expected_collection_kind text;
BEGIN
  SELECT * INTO publication
  FROM refresh_operations.operations operation
  WHERE operation.id = p_publication_operation_id
    AND operation.kind = 'statistics-publication'
    AND operation.status = 'awaiting_binding'
  FOR UPDATE;

  IF publication.id IS NULL THEN
    RETURN 'effect-conflict';
  END IF;
  expected_collection_kind := CASE publication.payload->>'product'
    WHEN 'ranked' THEN 'statistics-ranked-collection'
    WHEN 'lifetime' THEN 'statistics-lifetime-collection'
    ELSE NULL
  END;
  IF expected_collection_kind IS NULL
    OR (SELECT count(*) FROM refresh_operations.operations operation
        WHERE operation.id = ANY(p_collection_operation_ids)
          AND operation.effect_operation_id = operation.id
          AND operation.kind = expected_collection_kind)
       <> cardinality(p_collection_operation_ids) THEN
    RETURN 'effect-conflict';
  END IF;

  PERFORM 1 FROM refresh_operations.operations operation
  WHERE operation.id = ANY(p_collection_operation_ids)
  ORDER BY operation.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM refresh_operations.operations operation
    WHERE operation.effect_operation_id = ANY(p_collection_operation_ids)
      AND operation.status NOT IN ('succeeded', 'dead_letter')
  ) THEN
    RETURN 'collection-active';
  END IF;

  INSERT INTO statistics.statistics_collection_seals
    (collection_operation_id, publication_operation_id)
  SELECT collection_operation_id, publication.effect_operation_id
  FROM unnest(p_collection_operation_ids) collection_operation_id
  ON CONFLICT (collection_operation_id) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM statistics.statistics_collection_seals seal
    WHERE seal.collection_operation_id = ANY(p_collection_operation_ids)
      AND seal.publication_operation_id <> publication.effect_operation_id
  ) THEN
    RETURN 'effect-conflict';
  END IF;
  RETURN 'sealed';
END;
$$;

CREATE OR REPLACE FUNCTION statistics.record_statistics_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint,
  p_collection_operation_ids uuid[]
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing statistics.statistics_publication_effects%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 210));
  SELECT * INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  SELECT * INTO existing
  FROM statistics.statistics_publication_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = active.effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = active.effect_operation_id
      AND existing.operation_key = p_operation_key THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  IF active.id IS NULL
    OR active.kind <> 'statistics-publication'
    OR active.operation_key <> p_operation_key
    OR active.status <> 'leased'
    OR active.lease_owner <> p_lease_owner
    OR active.lease_token <> p_lease_token
    OR active.lease_expires_at <= clock_timestamp() THEN
    RETURN 'lease-lost';
  END IF;

  IF (SELECT count(*) FROM refresh_operations.operations operation
        WHERE operation.id = ANY(p_collection_operation_ids)
          AND operation.effect_operation_id = operation.id
          AND operation.kind IN ('statistics-ranked-collection', 'statistics-lifetime-collection'))
       <> cardinality(p_collection_operation_ids) THEN
    RETURN 'effect-conflict';
  END IF;

  PERFORM 1 FROM refresh_operations.operations operation
  WHERE operation.id = ANY(p_collection_operation_ids)
  ORDER BY operation.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM refresh_operations.operations operation
    WHERE operation.effect_operation_id = ANY(p_collection_operation_ids)
      AND operation.status NOT IN ('succeeded', 'dead_letter')
  ) THEN
    RETURN 'collection-active';
  END IF;

  IF (SELECT count(*) FROM statistics.statistics_collection_seals seal
      WHERE seal.collection_operation_id = ANY(p_collection_operation_ids)
        AND seal.publication_operation_id = active.effect_operation_id)
     <> cardinality(p_collection_operation_ids) THEN
    RETURN 'effect-conflict';
  END IF;

  INSERT INTO statistics.statistics_publication_effects
    (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION statistics.record_statistics_legend_meta_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing statistics.statistics_legend_meta_publication_effects%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 211));
  SELECT * INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  SELECT * INTO existing
  FROM statistics.statistics_legend_meta_publication_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = active.effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = active.effect_operation_id
      AND existing.operation_key = p_operation_key THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  IF active.id IS NULL
    OR active.kind <> 'statistics-legend-meta-publication'
    OR active.operation_key <> p_operation_key
    OR active.status <> 'leased'
    OR active.lease_owner <> p_lease_owner
    OR active.lease_token <> p_lease_token
    OR active.lease_expires_at <= clock_timestamp() THEN
    RETURN 'lease-lost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM statistics.legend_meta_publication_operations binding
    WHERE binding.generation_id = (active.payload->>'generationId')::uuid
      AND binding.operation_id = active.effect_operation_id
  ) THEN
    RETURN 'effect-conflict';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM statistics.publication_decisions decision
    WHERE decision.generation_id = (active.payload->>'generationId')::uuid
      AND decision.product = 'ranked'
  ) THEN
    RETURN 'prerequisite-missing';
  END IF;

  INSERT INTO statistics.statistics_legend_meta_publication_effects
    (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;

CREATE FUNCTION refresh_operations.record_statistics_collection_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT statistics.record_statistics_collection_effect($1, $2, $3, $4, $5);
$$;

CREATE FUNCTION refresh_operations.seal_statistics_collections_for_publication(
  p_publication_operation_id uuid,
  p_collection_operation_ids uuid[]
) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT statistics.seal_statistics_collections_for_publication($1, $2);
$$;

CREATE FUNCTION refresh_operations.record_statistics_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint,
  p_collection_operation_ids uuid[]
) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT statistics.record_statistics_publication_effect($1, $2, $3, $4, $5);
$$;

CREATE FUNCTION refresh_operations.record_statistics_legend_meta_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT statistics.record_statistics_legend_meta_publication_effect($1, $2, $3, $4);
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brawltome_dead_letter') THEN
    GRANT USAGE ON SCHEMA statistics TO brawltome_dead_letter;
    GRANT SELECT ON
      refresh_operations.statistics_collection_effects,
      refresh_operations.statistics_publication_effects,
      refresh_operations.statistics_legend_meta_publication_effects,
      refresh_operations.statistics_collection_seals
    TO brawltome_dead_letter;
  END IF;
END;
$$;`

export const moveEffectTables = {
  identity: 'statistics/0005',
  predecessor: 'statistics/0004',
  requires: ['refresh-operations/0028'],
  checksum: '62c2b2c3c7e3311e3abc157667bbdbbbe9551db63ab844cefda41637d5eb01c2',
  sql,
} as const
