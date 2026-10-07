// Validates the checks refresh-operations/0022 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_kind_check;
ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;
ALTER TABLE refresh_operations.schedules VALIDATE CONSTRAINT schedules_kind_check;
ALTER TABLE refresh_operations.schedules VALIDATE CONSTRAINT schedules_payload_by_kind;`

export const validateLeaderboardDeepCrawl = {
  identity: 'refresh-operations/0023',
  predecessor: 'refresh-operations/0022',
  checksum: 'e8ebc2cf9bd1f2aa6c47cb4a3f4319fee0f2570addff20065c818c5863b819cb',
  sql,
} as const
