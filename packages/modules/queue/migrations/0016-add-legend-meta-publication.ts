const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection', 'clan-discovery-projection', 'discovery-reconciliation',
    'statistics-ranked-collection', 'statistics-lifetime-collection', 'statistics-publication',
    'statistics-legend-meta-publication'
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
    OR
    (kind = 'statistics-legend-meta-publication'
      AND work_class = 'global-statistics'
      AND jsonb_typeof(payload->'generationId') = 'string'
      AND (payload->>'generationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND payload = jsonb_build_object('generationId', payload->>'generationId'))
  );

CREATE UNIQUE INDEX statistics_legend_meta_publication_root_operation_key
  ON refresh_operations.operations (operation_key)
  WHERE kind = 'statistics-legend-meta-publication' AND replayed_from_operation_id IS NULL;

CREATE TABLE refresh_operations.statistics_legend_meta_publication_effects (
  operation_key text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  lease_token bigint NOT NULL CHECK (lease_token > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION refresh_operations.record_statistics_legend_meta_publication_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing refresh_operations.statistics_legend_meta_publication_effects%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 211));
  SELECT * INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  SELECT * INTO existing
  FROM refresh_operations.statistics_legend_meta_publication_effects effect
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

  INSERT INTO refresh_operations.statistics_legend_meta_publication_effects
    (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addLegendMetaPublication = {
  identity: 'refresh-operations/0016',
  predecessor: 'refresh-operations/0015',
  checksum: 'c30910ab3ae243ce95084ebf36c3a4548a6049fef2d91fe8cbf028022859b63e',
  sql,
} as const
