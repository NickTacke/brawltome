// no running service uses the old name any more. dropping a view locks only the view, so the table behind it and
// refresh_operations.operations are not touched
const sql = `SET LOCAL lock_timeout = '5s';

DROP VIEW refresh_operations.primary_monitoring_reconciliation;`

export const dropPrimaryMonitoringWatermarkView = {
  identity: 'players/0022',
  predecessor: 'players/0021',
  requires: ['refresh-operations/0028'],
  checksum: '0828f4b1be16307dd0cbd1c183bd0ecf8e69d509a51804686a8c1bf01806f46c',
  sql,
} as const
