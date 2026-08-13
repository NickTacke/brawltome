const sql = `ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check
  CHECK (kind IN ('proof', 'interactive-player-refresh', 'leaderboard-1v1', 'clan-refresh'));

ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_payload_by_kind,
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
    OR
    (kind = 'clan-refresh'
      AND work_class = 'interactive'
      AND jsonb_typeof(payload->'clanId') = 'number'
      AND (payload->>'clanId') ~ '^[1-9][0-9]*$'
      AND jsonb_typeof(payload->'staleSections') = 'array'
      AND jsonb_array_length(payload->'staleSections') BETWEEN 1 AND 2
      AND payload->'staleSections' <@ '["profile", "roster"]'::jsonb)
  );

ALTER TABLE refresh_operations.interactive_refresh_effects
  DROP CONSTRAINT interactive_refresh_effects_section_check,
  ADD CONSTRAINT interactive_refresh_effects_section_check
  CHECK (section IN ('ranked', 'stats', 'profile', 'roster'));`

export const addClanRefresh = {
  identity: 'refresh-operations/0007',
  predecessor: 'refresh-operations/0006',
  checksum: '7e8aafa5721bef24c28a00dfcee3d39d6cc90aecbdc77abf70401cb5cb8cf6e7',
  sql,
} as const
