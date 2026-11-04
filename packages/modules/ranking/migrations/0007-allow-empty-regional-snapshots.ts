const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE rankings.snapshots
  DROP CONSTRAINT snapshots_row_count_check,
  ADD CONSTRAINT snapshots_row_count_check CHECK (row_count > 0 OR (row_count = 0 AND scope <> 'all'));`

export const allowEmptyRegionalLeaderboardSnapshots = {
  identity: 'rankings/0007',
  predecessor: 'rankings/0006',
  checksum: '039cd3414f6d8ab9d8857b9aaeb9d7f2ca50fd6bce8a4dae043120750f5cc376',
  sql,
} as const
