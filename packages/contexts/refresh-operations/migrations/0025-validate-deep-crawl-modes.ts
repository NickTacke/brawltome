// Validates the checks refresh-operations/0024 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;
ALTER TABLE refresh_operations.schedules VALIDATE CONSTRAINT schedules_payload_by_kind;`

export const validateDeepCrawlModes = {
  identity: 'refresh-operations/0025',
  predecessor: 'refresh-operations/0024',
  checksum: '1de1af805d41e42509fc6da298d4197d9139cae944e3c0aee3b80e8ee20107da',
  sql,
} as const
