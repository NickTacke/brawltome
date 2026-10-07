// Adds the deep 1v1 leaderboard crawl kind. Checks are widened NOT VALID (no table scan under ACCESS EXCLUSIVE) and
// validated by refresh-operations/0023; existing rows satisfy them because they only add an alternative.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  ADD CONSTRAINT operations_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'clan-refresh', 'ranked-player-pulse',
    'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3',
    'player-discovery-projection', 'clan-discovery-projection', 'discovery-reconciliation',
    'statistics-ranked-collection', 'statistics-lifetime-collection', 'statistics-publication',
    'statistics-legend-meta-publication', 'player-name-verification', 'ranking-retention', 'leaderboard-deep-crawl'
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
        -- NULL-safe: a CHECK that evaluates to NULL passes, which let rows without an assignmentId through before.
        AND (
          jsonb_typeof(payload->'assignmentId') IS NOT DISTINCT FROM 'string'
          OR (payload->>'cohort' IS NOT DISTINCT FROM 'recently-viewed' AND NOT payload ? 'assignmentId')
        )
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
      OR
    (kind = 'leaderboard-deep-crawl'
      AND work_class = 'leaderboard'
      AND payload->>'region' IN ('US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 3600000 AND 86400000
      AND payload = jsonb_build_object('region', payload->'region', 'intervalMs', payload->'intervalMs'))
  ) NOT VALID;

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  ADD CONSTRAINT schedules_kind_check CHECK (kind IN (
    'proof', 'interactive-player-refresh', 'leaderboard-1v1', 'leaderboard-2v2',
    'leaderboard-solo-2v2', 'leaderboard-3v3', 'ranking-retention', 'leaderboard-deep-crawl'
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
    OR
    (kind = 'leaderboard-deep-crawl'
      AND work_class = 'leaderboard'
      AND payload->>'region' IN ('US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')
      AND jsonb_typeof(payload->'intervalMs') = 'number'
      AND (payload->>'intervalMs') ~ '^[0-9]+$'
      AND (payload->>'intervalMs')::numeric BETWEEN 3600000 AND 86400000
      AND (payload->>'intervalMs')::bigint = interval_ms
      AND payload = jsonb_build_object('region', payload->'region', 'intervalMs', payload->'intervalMs'))
  ) NOT VALID;`

export const addLeaderboardDeepCrawl = {
  identity: 'refresh-operations/0022',
  predecessor: 'refresh-operations/0021',
  checksum: 'd2718fae515892acbbd85a89349b27e136f6e8b2d4c89ca1082934f6967ad66a',
  sql,
} as const
