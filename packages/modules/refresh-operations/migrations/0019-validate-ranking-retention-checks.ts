// Validates the checks refresh-operations/0018 added NOT VALID. VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE,
// so workers keep reading and writing operations and schedules while existing rows are scanned. It runs as its own
// migration because the runner wraps each migration in one transaction, and 0018's ACCESS EXCLUSIVE lock would
// otherwise be held through the scan.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_kind_check;
ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;
ALTER TABLE refresh_operations.schedules VALIDATE CONSTRAINT schedules_kind_check;
ALTER TABLE refresh_operations.schedules VALIDATE CONSTRAINT schedules_payload_by_kind;`

export const validateRankingRetentionChecks = {
  identity: 'refresh-operations/0019',
  predecessor: 'refresh-operations/0018',
  checksum: 'e8ebc2cf9bd1f2aa6c47cb4a3f4319fee0f2570addff20065c818c5863b819cb',
  sql,
} as const
