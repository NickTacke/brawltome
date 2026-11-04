const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN ('proof', 'interactive-player-refresh', 'leaderboard-1v1'));

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  ADD CONSTRAINT schedules_kind_check CHECK (kind IN ('proof', 'leaderboard-1v1'));

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
    (kind = 'leaderboard-1v1'
      AND work_class = 'leaderboard'
      AND jsonb_typeof(payload->'pageDepth') = 'number'
      AND (payload->>'pageDepth') ~ '^[0-9]+$'
      AND (payload->>'pageDepth')::numeric BETWEEN 1 AND 20
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 60000 AND 86400000)
  );

ALTER TABLE refresh_operations.schedules
  ADD CONSTRAINT schedules_payload_by_kind CHECK (
    (kind = 'proof' AND jsonb_typeof(payload->'value') = 'string')
    OR
    (kind = 'leaderboard-1v1'
      AND work_class = 'leaderboard'
      AND jsonb_typeof(payload->'pageDepth') = 'number'
      AND (payload->>'pageDepth') ~ '^[0-9]+$'
      AND (payload->>'pageDepth')::numeric BETWEEN 1 AND 20
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 60000 AND 86400000
      AND (payload->>'intervalMs')::bigint = interval_ms)
  );

CREATE TABLE refresh_operations.leaderboard_effects (
  operation_key text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  lease_token bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION refresh_operations.lock_active_leaderboard_lease(
  p_operation_id uuid,
  p_operation_key text,
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
    AND operation.kind = 'leaderboard-1v1'
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  RETURN coalesce(active, false);
END;
$$;

CREATE FUNCTION refresh_operations.record_leaderboard_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  operation_active boolean;
  existing refresh_operations.leaderboard_effects%ROWTYPE;
BEGIN
  PERFORM 1
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 201));

  SELECT * INTO existing
  FROM refresh_operations.leaderboard_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = p_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = p_operation_id
      AND existing.operation_key = p_operation_key
      AND existing.lease_token = p_lease_token THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  SELECT true INTO operation_active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
    AND operation.kind = 'leaderboard-1v1'
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp();

  IF NOT coalesce(operation_active, false) THEN
    RETURN 'lease-lost';
  END IF;

  INSERT INTO refresh_operations.leaderboard_effects (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, p_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addLeaderboardOperationKind = {
  identity: 'refresh-operations/0005',
  predecessor: 'refresh-operations/0004',
  checksum: 'cc91f02a20ef0e3489a981552e71c01aedbbe19c7facf24e3c420d4ab2622abb',
  sql,
} as const
