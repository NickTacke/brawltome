// see refresh-operations/0029 for why each table is dropped from on its own
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.interactive_refresh_effects
  DROP CONSTRAINT interactive_refresh_effects_section_check;`

export const dropInteractiveSectionCheck = {
  identity: 'refresh-operations/0031',
  predecessor: 'refresh-operations/0030',
  checksum: '146aef39269ea083a9b159690a79570dd47086be58026106cf26ba0938fda8ea',
  sql,
} as const
