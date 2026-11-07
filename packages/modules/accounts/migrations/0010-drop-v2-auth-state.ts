// the V2 sign-in fallback is gone, so nothing reads the cutover state or which sessions came from V2
const sql = `SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS accounts.v2_auth_cutover;

ALTER TABLE IF EXISTS accounts.sessions DROP COLUMN IF EXISTS imported_from_v2;
`

export const dropV2AuthState = {
  identity: 'accounts/0010',
  predecessor: 'accounts/0009',
  checksum: 'b532e6322b6ed141830e3b0c3aaf76304e9b2d930d502eca4b3c479bf4b4d3a3',
  sql,
} as const
