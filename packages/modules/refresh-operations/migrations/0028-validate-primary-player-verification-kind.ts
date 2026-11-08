// Validates the checks refresh-operations/0027 added NOT VALID, under SHARE UPDATE EXCLUSIVE in its own transaction.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_kind_check;
ALTER TABLE refresh_operations.operations VALIDATE CONSTRAINT operations_payload_by_kind;`

export const validatePrimaryPlayerVerificationKind = {
  identity: 'refresh-operations/0028',
  predecessor: 'refresh-operations/0027',
  checksum: '7b6a49cfd1afceed8df65084d2b43ac0fc2d417500e999e43bbddb8e0c5aca59',
  sql,
} as const
