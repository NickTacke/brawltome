const sql = `CREATE TABLE refresh_operations.interactive_refresh_effects (
  operation_id uuid NOT NULL REFERENCES refresh_operations.operations(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('ranked', 'stats')),
  lease_token bigint NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, section)
);`

export const addInteractiveRefreshCheckpoints = {
  identity: 'refresh-operations/0004',
  predecessor: 'refresh-operations/0003',
  checksum: '34ab6f76aa894f80e8f9316742b6c8a23e44f816768e5967c887817dc1a8c7bc',
  sql,
} as const
