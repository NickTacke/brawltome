// no running service uses the old name any more. dropping a view locks only the view, so the table behind it and
// refresh_operations.operations are not touched
const sql = `SET LOCAL lock_timeout = '5s';

DROP VIEW refresh_operations.proof_effects;`

export const dropProofEffectsView = {
  identity: 'accounts/0012',
  predecessor: 'accounts/0011',
  requires: ['refresh-operations/0028'],
  checksum: 'a3a8316decbd97374886d2643a90d97bf5ed0d7d444a4ba8799f782cd40e1b70',
  sql,
} as const
