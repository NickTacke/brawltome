const sql = `CREATE TABLE accounts.v2_auth_cutover (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  finalized_at timestamptz NOT NULL
);
`

export const addV2AuthCutoverState = {
  identity: 'accounts/0002',
  predecessor: 'accounts/0001',
  checksum: '0267bc15fea9cf27bf8d08434e9c7cb3f8c054beb9274619a770236f116bf99c',
  sql,
} as const
