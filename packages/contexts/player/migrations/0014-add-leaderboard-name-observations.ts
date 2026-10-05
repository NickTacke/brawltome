const sql = `CREATE TABLE players.leaderboard_name_observations (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text NOT NULL,
  observed_at timestamptz NOT NULL
);`

export const addLeaderboardNameObservations = {
  identity: 'players/0014',
  predecessor: 'players/0013',
  checksum: 'd13a72e3c478ea4e743402294e668b3db744a95eac3341ec296c7b5b2bc791d6',
  sql,
} as const
