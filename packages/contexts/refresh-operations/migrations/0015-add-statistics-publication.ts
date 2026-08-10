const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection', 'clan-discovery-projection', 'discovery-reconciliation',
    'statistics-ranked-collection', 'statistics-lifetime-collection', 'statistics-publication'
  ));

ALTER TABLE refresh_operations.operations DROP CONSTRAINT operations_payload_by_kind;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_payload_by_kind CHECK (
    (kind = 'proof' AND jsonb_typeof(payload->'value') = 'string')
    OR
    (kind = 'interactive-player-refresh'
      AND work_class IN ('interactive', 'primary-monitoring')
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'staleSections') = 'array'
      AND jsonb_array_length(payload->'staleSections') BETWEEN 1 AND 2
      AND payload->'staleSections' <@ '["ranked", "stats"]'::jsonb
      AND (work_class <> 'primary-monitoring' OR (
        payload->'staleSections' = '["ranked", "stats"]'::jsonb
        AND jsonb_typeof(payload->'assignmentId') = 'string'
      )))
    OR
    (kind = 'clan-refresh'
      AND work_class = 'interactive'
      AND jsonb_typeof(payload->'clanId') = 'number'
      AND (payload->>'clanId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'staleSections') = 'array'
      AND jsonb_array_length(payload->'staleSections') BETWEEN 1 AND 2
      AND payload->'staleSections' <@ '["profile", "roster"]'::jsonb)
    OR
    (kind = 'ranked-player-pulse'
      AND work_class = 'primary-monitoring'
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$')
    OR
    (kind IN ('leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3')
      AND work_class = 'leaderboard'
      AND jsonb_typeof(payload->'pageDepth') = 'number'
      AND (payload->>'pageDepth') ~ '^[0-9]+$'
      AND (payload->>'pageDepth')::numeric BETWEEN 1 AND 20
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 60000 AND 86400000)
    OR
    (kind IN ('player-discovery-projection', 'clan-discovery-projection')
      AND work_class = 'projection'
      AND jsonb_typeof(payload->'batchSize') = 'number'
      AND (payload->>'batchSize') ~ '^[1-9][0-9]*$'
      AND (payload->>'batchSize')::numeric BETWEEN 1 AND 1000)
    OR
    (kind = 'discovery-reconciliation'
      AND work_class = 'projection'
      AND payload->>'owner' IN ('player', 'clan')
      AND payload = jsonb_build_object('owner', payload->>'owner'))
    OR
    (kind IN ('statistics-ranked-collection', 'statistics-lifetime-collection')
      AND work_class = 'global-statistics'
      AND jsonb_typeof(payload->'cohortId') = 'string'
      AND (payload->>'cohortId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$')
    OR
    (kind = 'statistics-publication'
      AND work_class = 'global-statistics'
      AND jsonb_typeof(payload->'generationId') = 'string'
      AND (payload->>'generationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND payload->>'product' IN ('ranked', 'lifetime')
      AND payload = jsonb_build_object(
        'generationId', payload->>'generationId',
        'product', payload->>'product'
      ))
  );

CREATE UNIQUE INDEX statistics_publication_root_operation_key
  ON refresh_operations.operations (operation_key)
  WHERE kind = 'statistics-publication' AND replayed_from_operation_id IS NULL;

CREATE TABLE refresh_operations.statistics_publication_effects (
  operation_key text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  lease_token bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE refresh_operations.statistics_collection_seals (
  collection_operation_id uuid PRIMARY KEY REFERENCES refresh_operations.operations(id),
  publication_operation_id uuid NOT NULL REFERENCES refresh_operations.operations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION refresh_operations.seal_statistics_collections_for_publication(
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

  INSERT INTO refresh_operations.statistics_collection_seals
    (collection_operation_id, publication_operation_id)
  SELECT collection_operation_id, publication.effect_operation_id
  FROM unnest(p_collection_operation_ids) collection_operation_id
  ON CONFLICT (collection_operation_id) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM refresh_operations.statistics_collection_seals seal
    WHERE seal.collection_operation_id = ANY(p_collection_operation_ids)
      AND seal.publication_operation_id <> publication.effect_operation_id
  ) THEN
    RETURN 'effect-conflict';
  END IF;
  RETURN 'sealed';
END;
$$;

CREATE FUNCTION refresh_operations.record_statistics_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint,
  p_collection_operation_ids uuid[]
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing refresh_operations.statistics_publication_effects%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 210));
  SELECT * INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  SELECT * INTO existing
  FROM refresh_operations.statistics_publication_effects effect
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

  IF (SELECT count(*) FROM refresh_operations.statistics_collection_seals seal
      WHERE seal.collection_operation_id = ANY(p_collection_operation_ids)
        AND seal.publication_operation_id = active.effect_operation_id)
     <> cardinality(p_collection_operation_ids) THEN
    RETURN 'effect-conflict';
  END IF;

  INSERT INTO refresh_operations.statistics_publication_effects
    (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addStatisticsPublication = {
  identity: 'refresh-operations/0015',
  predecessor: 'refresh-operations/0014',
  checksum: '8c974f3ca7a1c16fbfd5c18c3f277f135d5215cc8002e13e413b5b70453ca0f3',
  sql,
} as const
