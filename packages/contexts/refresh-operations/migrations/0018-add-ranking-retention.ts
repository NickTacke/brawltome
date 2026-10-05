// The widened checks are added NOT VALID so this migration never scans a table while it holds ACCESS EXCLUSIVE.
// They are enforced for new rows at once; refresh-operations/0019 validates existing rows in its own transaction
// under SHARE UPDATE EXCLUSIVE. Every existing row already satisfies them: they only add an alternative.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection', 'clan-discovery-projection', 'discovery-reconciliation',
    'statistics-ranked-collection', 'statistics-lifetime-collection', 'statistics-publication',
    'statistics-legend-meta-publication', 'player-name-verification', 'ranking-retention'
  )) NOT VALID;

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
    OR
    (kind = 'player-name-verification'
      AND work_class = 'maintenance'
      AND jsonb_typeof(payload->'brawlhallaId') = 'number'
      AND (payload->>'brawlhallaId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'playerName') = 'string'
      AND payload = jsonb_build_object('brawlhallaId', payload->'brawlhallaId', 'playerName', payload->'playerName'))
    OR
    (kind = 'ranking-retention'
      AND work_class = 'maintenance'
      AND jsonb_typeof(payload->'retentionHours') = 'number'
      AND (payload->>'retentionHours') ~ '^[0-9]+$'
      AND (payload->>'retentionHours')::numeric BETWEEN 24 AND 8760
      AND jsonb_typeof(payload->'maxGenerations') = 'number'
      AND (payload->>'maxGenerations') ~ '^[0-9]+$'
      AND (payload->>'maxGenerations')::numeric BETWEEN 1 AND 200
      AND payload = jsonb_build_object(
        'retentionHours', payload->'retentionHours',
        'maxGenerations', payload->'maxGenerations'
      ))
  ) NOT VALID;

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  ADD CONSTRAINT schedules_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'leaderboard-1v1', 'leaderboard-2v2',
    'leaderboard-solo-2v2', 'leaderboard-3v3', 'ranking-retention'
  )) NOT VALID;

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
    OR
    (kind = 'ranking-retention'
      AND work_class = 'maintenance'
      AND jsonb_typeof(payload->'retentionHours') = 'number'
      AND (payload->>'retentionHours') ~ '^[0-9]+$'
      AND (payload->>'retentionHours')::numeric BETWEEN 24 AND 8760
      AND jsonb_typeof(payload->'maxGenerations') = 'number'
      AND (payload->>'maxGenerations') ~ '^[0-9]+$'
      AND (payload->>'maxGenerations')::numeric BETWEEN 1 AND 200
      AND payload = jsonb_build_object(
        'retentionHours', payload->'retentionHours',
        'maxGenerations', payload->'maxGenerations'
      ))
  ) NOT VALID;

CREATE FUNCTION refresh_operations.lock_active_ranking_retention_lease(
  p_operation_id uuid,
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
    AND operation.kind = 'ranking-retention'
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF active THEN
    -- Remembers, for this transaction only, which lease row it holds locked so completion can be fenced on it.
    PERFORM set_config(
      'refresh_operations.ranking_retention_lease', p_operation_id::text || ':' || p_lease_token::text, true
    );
  END IF;
  RETURN coalesce(active, false);
END;
$$;

-- Completes the attempt in the transaction that deleted the batch. The lease was current when
-- lock_active_ranking_retention_lease locked its row, and that row lock is held until commit, so no other worker
-- can have reclaimed it; completing here is fenced even if the batch outlived lease_expires_at.
CREATE FUNCTION refresh_operations.complete_ranking_retention_lease(
  p_operation_id uuid,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  attempt integer;
BEGIN
  IF coalesce(pg_catalog.current_setting('refresh_operations.ranking_retention_lease', true), '')
    <> p_operation_id::text || ':' || p_lease_token::text THEN
    RAISE EXCEPTION 'ranking retention lease row is not locked by this transaction';
  END IF;
  UPDATE refresh_operations.operations operation
  SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
      completed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE operation.id = p_operation_id
    AND operation.kind = 'ranking-retention'
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
  RETURNING operation.attempt_count INTO attempt;
  IF attempt IS NULL THEN
    RETURN false;
  END IF;
  UPDATE refresh_operations.attempts
  SET finished_at = clock_timestamp(), outcome = 'succeeded'
  WHERE operation_id = p_operation_id AND attempt_number = attempt;
  RETURN true;
END;
$$;`

export const addRankingRetention = {
  identity: 'refresh-operations/0018',
  predecessor: 'refresh-operations/0017',
  checksum: 'd30748d7520efbcefa5e734380da575f326d608070529975fcd9fd5b9b1e8c51',
  sql,
} as const
