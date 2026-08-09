const sql = `CREATE TABLE players.interactive_refresh_effects (
  operation_id uuid NOT NULL,
  section text NOT NULL CHECK (section IN ('ranked', 'stats')),
  lease_token bigint NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, section)
);`

export const addInteractiveRefreshEffects = {
  identity: 'players/0002',
  predecessor: 'players/0001',
  checksum: 'fc28d5cfebc3578e98941194f7d3a82f49acb66048c522c60579bc5952b8d813',
  sql,
} as const
