const sql = `CREATE TABLE accounts.preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts.users(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL CHECK (schema_version > 0),
  leaderboard_bracket text NOT NULL CHECK (leaderboard_bracket IN ('1v1', '2v2', 'solo2v2', '3v3')),
  leaderboard_region text NOT NULL CHECK (leaderboard_region IN ('all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`

export const addAccountPreferences = {
  identity: 'accounts/0003',
  predecessor: 'accounts/0002',
  checksum: '3b6a89bd5b60420ac04471559c2b8a8e27495b52135e176438910de3611696a3',
  sql,
} as const
