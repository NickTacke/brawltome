const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'leaderboard-1v1',
    'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
  ));

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  ADD CONSTRAINT schedules_kind_check CHECK (kind IN (
    'proof', 'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
  ));

ALTER TABLE refresh_operations.operations DROP CONSTRAINT operations_payload_by_kind;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_payload_by_kind CHECK (
    (kind = 'proof' AND jsonb_typeof(payload->'value') = 'string')
    OR
    (kind = 'interactive-player-refresh'
      AND work_class = 'interactive'
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'staleSections') = 'array'
      AND jsonb_array_length(payload->'staleSections') BETWEEN 1 AND 2
      AND payload->'staleSections' <@ '["ranked", "stats"]'::jsonb)
    OR
    (kind = 'clan-refresh'
      AND work_class = 'interactive'
      AND jsonb_typeof(payload->'clanId') = 'number'
      AND (payload->>'clanId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'staleSections') = 'array'
      AND jsonb_array_length(payload->'staleSections') BETWEEN 1 AND 2
      AND payload->'staleSections' <@ '["profile", "roster"]'::jsonb)
    OR
    (kind IN ('leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3')
      AND work_class = 'leaderboard'
      AND jsonb_typeof(payload->'pageDepth') = 'number'
      AND (payload->>'pageDepth') ~ '^[0-9]+$'
      AND (payload->>'pageDepth')::numeric BETWEEN 1 AND 20
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 60000 AND 86400000)
  );

ALTER TABLE refresh_operations.schedules DROP CONSTRAINT schedules_payload_by_kind;
ALTER TABLE refresh_operations.schedules
  ADD CONSTRAINT schedules_payload_by_kind CHECK (
    (kind = 'proof' AND jsonb_typeof(payload->'value') = 'string')
    OR
    (kind IN ('leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3')
      AND work_class = 'leaderboard'
      AND jsonb_typeof(payload->'pageDepth') = 'number'
      AND (payload->>'pageDepth') ~ '^[0-9]+$'
      AND (payload->>'pageDepth')::numeric BETWEEN 1 AND 20
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 60000 AND 86400000
      AND (payload->>'intervalMs')::bigint = interval_ms)
  );

ALTER TABLE refresh_operations.leaderboard_effects
  ADD COLUMN operation_kind text NOT NULL DEFAULT 'leaderboard-1v1'
    CHECK (operation_kind IN (
      'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
    ));
ALTER TABLE refresh_operations.leaderboard_effects ALTER COLUMN operation_kind DROP DEFAULT;

DROP FUNCTION refresh_operations.lock_active_leaderboard_lease(uuid, text, text, bigint);
CREATE FUNCTION refresh_operations.lock_active_leaderboard_lease(
  p_operation_id uuid,
  p_operation_key text,
  p_operation_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  active boolean;
BEGIN
  SELECT true INTO active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
    AND operation.kind = p_operation_kind
    AND operation.kind IN (
      'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
    )
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  RETURN coalesce(active, false);
END;
$$;

DROP FUNCTION refresh_operations.record_leaderboard_effect(uuid, text, text, bigint);
CREATE FUNCTION refresh_operations.record_leaderboard_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_operation_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  operation_active boolean;
  effect_operation_id uuid;
  existing refresh_operations.leaderboard_effects%ROWTYPE;
BEGIN
  SELECT operation.effect_operation_id INTO effect_operation_id
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  IF effect_operation_id IS NULL THEN
    RETURN 'lease-lost';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 201));

  SELECT * INTO existing
  FROM refresh_operations.leaderboard_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = effect_operation_id
      AND existing.operation_key = p_operation_key
      AND existing.operation_kind = p_operation_kind THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  SELECT true INTO operation_active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
    AND operation.kind = p_operation_kind
    AND operation.kind IN (
      'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
    )
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp();

  IF NOT coalesce(operation_active, false) THEN
    RETURN 'lease-lost';
  END IF;

  INSERT INTO refresh_operations.leaderboard_effects
    (operation_key, operation_id, operation_kind, lease_token)
  VALUES (p_operation_key, effect_operation_id, p_operation_kind, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addLeaderboardOperationModes = {
  identity: 'refresh-operations/0009',
  predecessor: 'refresh-operations/0008',
  checksum: '8c91d27975f4f672485a354c6486980f5aaac597ef9d29662b7b9476d6b3dc60',
  sql,
} as const
