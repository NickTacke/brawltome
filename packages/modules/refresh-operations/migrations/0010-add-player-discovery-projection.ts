const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'leaderboard-1v1',
    'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
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
  );`

export const addPlayerDiscoveryProjection = {
  identity: 'refresh-operations/0010',
  predecessor: 'refresh-operations/0009',
  checksum: '951803dec9356108ebc1f786b55816a1baa10f118c4dc014b45ccd49f7c3dfbd',
  sql,
} as const
