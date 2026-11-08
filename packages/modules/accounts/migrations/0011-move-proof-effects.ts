// Proof effects move to their owner. The release still serving, and a rollback to it, keep reading and writing the old
// name through a view until the views are dropped in a later release. One table, so one short ACCESS EXCLUSIVE lock.
// The dead-letter role can read proof effects today and that grant moved with the table, but a view is a new object,
// so it is granted here too: the operator role keeps working on both names before its script next runs.
const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE refresh_operations.proof_effects SET SCHEMA accounts;

CREATE VIEW refresh_operations.proof_effects AS
  SELECT operation_key, operation_id, lease_token, effect_value, created_at FROM accounts.proof_effects;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brawltome_dead_letter') THEN
    GRANT USAGE ON SCHEMA accounts TO brawltome_dead_letter;
    GRANT SELECT ON refresh_operations.proof_effects TO brawltome_dead_letter;
  END IF;
END;
$$;`

export const moveProofEffects = {
  identity: 'accounts/0011',
  predecessor: 'accounts/0010',
  requires: ['refresh-operations/0028'],
  checksum: '0a49e8c53720e1a02ef626908e3a01aadbdeb77d2bdcfe859f248f959e72d171',
  sql,
} as const
