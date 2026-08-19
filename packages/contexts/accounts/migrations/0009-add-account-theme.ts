const sql = `ALTER TABLE accounts.preferences
  ADD COLUMN theme text NOT NULL DEFAULT 'neutral'
    CHECK (theme IN ('neutral', 'purple'));

UPDATE accounts.preferences
SET schema_version = 2;
`

export const addAccountTheme = {
  identity: 'accounts/0009',
  predecessor: 'accounts/0008',
  checksum: 'cb5477a317075e79293be535795e304911edd76bc58ced67ac14ac1091288aee',
  sql,
} as const
