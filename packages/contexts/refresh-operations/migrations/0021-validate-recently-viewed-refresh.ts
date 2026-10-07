// Validates the check refresh-operations/0020 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction,
// and indexes the view requests the freshness planner reads (a brief SHARE lock on ~76k rows).
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;

-- The freshness planner reads recent view requests every pass.
CREATE INDEX refresh_operations_interactive_player_views
  ON refresh_operations.operations (created_at)
  WHERE kind = 'interactive-player-refresh' AND work_class = 'interactive';`

export const validateRecentlyViewedRefresh = {
  identity: 'refresh-operations/0021',
  predecessor: 'refresh-operations/0020',
  checksum: '7a00505be75ceb79856abc31871191c160fa85d3770d6524c961d2a6aa999fee',
  sql,
} as const
