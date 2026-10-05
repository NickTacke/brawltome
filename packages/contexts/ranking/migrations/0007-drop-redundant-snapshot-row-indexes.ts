const sql = `SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS rankings.rankings_snapshot_rows_standing;
DROP INDEX IF EXISTS rankings.rankings_snapshot_rows_mode_standing;`

export const dropRedundantSnapshotRowIndexes = {
  identity: 'rankings/0007',
  predecessor: 'rankings/0006',
  checksum: '33dd5fec8401b5b463ca9f5f70507d092e8c1f4e4b63ec4e73f760b17801863d',
  sql,
} as const
