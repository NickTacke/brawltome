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
);`

export const addLeaderboardTeamModeObservations = {
  identity: 'players/0019',
  predecessor: 'players/0018',
  checksum: '75032a9b1789501be2f50f6e03fadf8dcae18169b289aa5c72aec789c656e4c5',
  sql,
} as const
