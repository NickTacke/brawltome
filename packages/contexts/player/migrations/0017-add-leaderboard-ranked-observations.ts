const sql = `CREATE TABLE players.leaderboard_ranked_observations (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  region text NOT NULL CHECK (length(region) > 0),
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text CHECK (tier IS NULL OR length(tier) > 0),
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= wins),
  observed_at timestamptz NOT NULL
);`

export const addLeaderboardRankedObservations = {
  identity: 'players/0017',
  predecessor: 'players/0016',
  checksum: '9f3bd2363af9820680c21e130360575a82b915582872e7123295ee1aebc262d8',
  sql,
} as const
