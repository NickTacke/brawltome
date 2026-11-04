const sql = `CREATE TABLE accounts.saved_players (
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  brawlhalla_id bigint NOT NULL CHECK (brawlhalla_id BETWEEN 1 AND 2147483647),
  position integer NOT NULL CHECK (position >= 0),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, brawlhalla_id),
  CONSTRAINT accounts_saved_players_account_position_unique
    UNIQUE (account_id, position) DEFERRABLE INITIALLY DEFERRED
);
`

export const addSavedPlayers = {
  identity: 'accounts/0005',
  predecessor: 'accounts/0004',
  checksum: '979f9c419e6d6ec189ad92c7cf1385002fd30584285aab2220fd42560ef8c8c5',
  sql,
} as const
