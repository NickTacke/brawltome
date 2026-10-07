const sql = `CREATE TABLE players.leaderboard_solo_queue_observations (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  region text NOT NULL CHECK (length(region) > 0),
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text CHECK (tier IS NULL OR length(tier) > 0),
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= wins),
  observed_at timestamptz NOT NULL
);

CREATE TABLE players.leaderboard_team_observations (
  brawlhalla_id_one integer NOT NULL CHECK (brawlhalla_id_one > 0),
  brawlhalla_id_two integer NOT NULL CHECK (brawlhalla_id_two > brawlhalla_id_one),
  region text NOT NULL CHECK (length(region) > 0),
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text CHECK (tier IS NULL OR length(tier) > 0),
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= wins),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (brawlhalla_id_one, brawlhalla_id_two)
);

CREATE INDEX players_leaderboard_team_observations_two ON players.leaderboard_team_observations (brawlhalla_id_two);`

export const addLeaderboardTeamModeObservations = {
  identity: 'players/0019',
  predecessor: 'players/0018',
  checksum: 'c3d9253a8b9bcb25fd437e3721e73b605f936e0779f7c3512b9627a319f27614',
  sql,
} as const
