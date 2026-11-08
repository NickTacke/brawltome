// The watermark moves to its owner. The release still serving, and a rollback to it, keep reading and writing the old
// name through a view until the views are dropped in a later release. One table, so one short ACCESS EXCLUSIVE lock.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.primary_monitoring_reconciliation SET SCHEMA players;

CREATE VIEW refresh_operations.primary_monitoring_reconciliation AS
  SELECT singleton, observed_at FROM players.primary_monitoring_reconciliation;`

export const movePrimaryMonitoringWatermark = {
  identity: 'players/0021',
  predecessor: 'players/0020',
  requires: ['refresh-operations/0028'],
  checksum: 'd1676230e6b46f1aac25189b82c1dbfde86a10a40cdfb5b37e1fbcbfb23f29a1',
  sql,
} as const
