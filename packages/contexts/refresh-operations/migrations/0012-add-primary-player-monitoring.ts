const sql = `ALTER TABLE refresh_operations.operations
  ADD COLUMN resource_key text;

ALTER TABLE refresh_operations.schedules
  ADD COLUMN resource_key text;

CREATE FUNCTION refresh_operations.set_player_resource_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'interactive-player-refresh' THEN
    NEW.resource_key := 'player:' || (NEW.payload->>'brawlhallaId');
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER operations_set_player_resource_key
BEFORE INSERT OR UPDATE OF kind, payload, resource_key ON refresh_operations.operations
FOR EACH ROW EXECUTE FUNCTION refresh_operations.set_player_resource_key();

UPDATE refresh_operations.operations
SET resource_key = 'player:' || (payload->>'brawlhallaId')
WHERE kind = 'interactive-player-refresh';

WITH ranked AS (
  SELECT id, attempt_count,
         row_number() OVER (
           PARTITION BY resource_key
           ORDER BY (status = 'leased') DESC, created_at, id
         ) AS resource_rank
  FROM refresh_operations.operations
  WHERE resource_key IS NOT NULL AND status IN ('awaiting_admission', 'pending', 'leased')
)
UPDATE refresh_operations.attempts attempt
SET finished_at = clock_timestamp(), outcome = 'dead_letter',
    error = '{"code":"superseded_player_refresh","message":"Superseded while adding player refresh identity","retryable":false}'::jsonb
FROM ranked
WHERE ranked.resource_rank > 1
  AND attempt.operation_id = ranked.id
  AND attempt.attempt_number = ranked.attempt_count
  AND attempt.finished_at IS NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY resource_key
           ORDER BY (status = 'leased') DESC, created_at, id
         ) AS resource_rank
  FROM refresh_operations.operations
  WHERE resource_key IS NOT NULL AND status IN ('awaiting_admission', 'pending', 'leased')
)
UPDATE refresh_operations.operations operation
SET status = 'dead_letter', reservation_token = NULL, reservation_expires_at = NULL,
    lease_owner = NULL, lease_expires_at = NULL, completed_at = clock_timestamp(),
    last_error = '{"code":"superseded_player_refresh","message":"Superseded while adding player refresh identity","retryable":false}'::jsonb,
    updated_at = clock_timestamp()
FROM ranked
WHERE ranked.resource_rank > 1 AND operation.id = ranked.id;

ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_player_resource_key CHECK (
    kind <> 'interactive-player-refresh'
    OR resource_key = 'player:' || (payload->>'brawlhallaId')
  );

CREATE UNIQUE INDEX refresh_operations_active_resource
  ON refresh_operations.operations (resource_key)
  WHERE resource_key IS NOT NULL
    AND status IN ('awaiting_admission', 'pending', 'leased');

ALTER TABLE refresh_operations.schedule_occurrences
  ALTER COLUMN operation_id DROP NOT NULL,
  ADD COLUMN deduplicated_to_operation_id uuid REFERENCES refresh_operations.operations(id),
  ADD COLUMN disposition text NOT NULL DEFAULT 'materialized'
    CHECK (disposition IN ('materialized', 'deduplicated')),
  ADD CONSTRAINT schedule_occurrence_operation_check CHECK (
    (disposition = 'materialized' AND operation_id IS NOT NULL AND deduplicated_to_operation_id IS NULL)
    OR
    (disposition = 'deduplicated' AND operation_id IS NULL AND deduplicated_to_operation_id IS NOT NULL)
  );

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  ADD CONSTRAINT schedules_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'leaderboard-1v1', 'leaderboard-2v2',
    'leaderboard-solo-2v2', 'leaderboard-3v3'
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
    (kind = 'player-discovery-projection'
      AND work_class = 'projection'
      AND jsonb_typeof(payload->'batchSize') = 'number'
      AND (payload->>'batchSize') ~ '^[1-9][0-9]*$'
      AND (payload->>'batchSize')::numeric BETWEEN 1 AND 1000)
  );

ALTER TABLE refresh_operations.schedules DROP CONSTRAINT schedules_payload_by_kind;
ALTER TABLE refresh_operations.schedules
  ADD CONSTRAINT schedules_payload_by_kind CHECK (
    (kind = 'proof' AND jsonb_typeof(payload->'value') = 'string')
    OR
    (kind = 'interactive-player-refresh'
      AND work_class = 'primary-monitoring'
      AND interval_ms = 86400000
      AND resource_key IS NOT NULL
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$'
      AND payload->'staleSections' = '["ranked", "stats"]'::jsonb
      AND jsonb_typeof(payload->'assignmentId') = 'string')
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

CREATE TABLE refresh_operations.primary_monitoring_reconciliation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  observed_at timestamptz NOT NULL
);`

export const addPrimaryPlayerMonitoring = {
  identity: 'refresh-operations/0012',
  predecessor: 'refresh-operations/0011',
  checksum: '46b5a4dcb1b6f5b324492bf46f06338febdc6956497fbd796309b161c205d15b',
  sql,
} as const
