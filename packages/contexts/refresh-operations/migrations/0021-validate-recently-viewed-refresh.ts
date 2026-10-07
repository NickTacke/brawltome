// Validates the check refresh-operations/0020 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;`

export const validateRecentlyViewedRefresh = {
  identity: 'refresh-operations/0021',
  predecessor: 'refresh-operations/0020',
  checksum: 'c0545c2a65756f6dcc7732a9dadfc17ba7c861249285fdd0f02ea55a825639d3',
  sql,
} as const
