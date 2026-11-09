// see refresh-operations/0029 for why each table is dropped from on its own
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  DROP CONSTRAINT schedules_payload_by_kind;`

export const dropScheduleKindConstraints = {
  identity: 'refresh-operations/0030',
  predecessor: 'refresh-operations/0029',
  checksum: '1a61ff370d84645ea2a96b840f42360946db258adba6216fa6eac51b8b09ecf0',
  sql,
} as const
