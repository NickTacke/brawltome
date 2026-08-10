const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection'
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
    (kind = 'player-discovery-projection'
      AND work_class = 'projection'
      AND jsonb_typeof(payload->'batchSize') = 'number'
      AND (payload->>'batchSize') ~ '^[1-9][0-9]*$'
      AND (payload->>'batchSize')::numeric BETWEEN 1 AND 1000)
  );

CREATE OR REPLACE FUNCTION refresh_operations.commit_interactive_section_if_owned(
  requested_operation_id uuid,
  requested_lease_owner text,
  requested_lease_token bigint,
  requested_section text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  effect_operation_id uuid;
BEGIN
  SELECT operation.effect_operation_id INTO effect_operation_id
  FROM refresh_operations.operations operation
  WHERE operation.id = requested_operation_id
    AND operation.kind IN ('interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse')
    AND operation.status = 'leased'
    AND operation.lease_owner = requested_lease_owner
    AND operation.lease_token = requested_lease_token
    AND operation.lease_expires_at > clock_timestamp()
  FOR UPDATE;

  IF effect_operation_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
  VALUES (effect_operation_id, requested_section, requested_lease_token)
  ON CONFLICT (operation_id, section) DO NOTHING;
  RETURN true;
END;
$$;`

export const addRankedPlayerPulseOperation = {
  identity: 'refresh-operations/0011',
  predecessor: 'refresh-operations/0010',
  checksum: '538e16caf6c1ae189d2610648055c26964f153d66c4d2502611848fdfeaf7443',
  sql,
} as const
