const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection', 'clan-discovery-projection', 'discovery-reconciliation',
    'statistics-ranked-collection', 'statistics-lifetime-collection'
  ));

ALTER TABLE refresh_operations.operations DROP CONSTRAINT operations_status_check;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_status_check
  CHECK (status IN ('awaiting_admission', 'awaiting_binding', 'pending', 'leased', 'succeeded', 'dead_letter'));

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
  );

CREATE UNIQUE INDEX statistics_collection_root_operation_key
  ON refresh_operations.operations (operation_key)
  WHERE kind IN ('statistics-ranked-collection', 'statistics-lifetime-collection')
    AND replayed_from_operation_id IS NULL;

CREATE TABLE refresh_operations.statistics_collection_effects (
  operation_key text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  kind text NOT NULL CHECK (kind IN ('statistics-ranked-collection', 'statistics-lifetime-collection')),
  lease_token bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION refresh_operations.record_statistics_collection_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active refresh_operations.operations%ROWTYPE;
  existing refresh_operations.statistics_collection_effects%ROWTYPE;
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
  FROM refresh_operations.statistics_collection_effects effect
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

  INSERT INTO refresh_operations.statistics_collection_effects
    (operation_key, operation_id, kind, lease_token)
  VALUES (p_operation_key, active.effect_operation_id, p_kind, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addStatisticsCollection = {
  identity: 'refresh-operations/0014',
  predecessor: 'refresh-operations/0013',
  checksum: '362cad045add7a167396a82fb703ddf45fb8de7ee1c3f641cdf2b887c72fe6b1',
  sql,
} as const
