// the name a 2v2 team name gives a player, read when the teammate's profile (profile_brawlhalla_id) was refreshed.
// it is a hint for name verification, kept apart from leaderboard_name_observations because those names are
// searchable and the next leaderboard scan would overwrite it
const sql = `CREATE TABLE players.teammate_name_signals (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text NOT NULL,
  profile_brawlhalla_id integer NOT NULL CHECK (profile_brawlhalla_id > 0),
  observed_at timestamptz NOT NULL
);`

export const addTeammateNameSignals = {
  identity: 'players/0023',
  predecessor: 'players/0022',
  checksum: 'e6f12331c71108b95858351e9e6bce02c9fca20cfd200ae2348fd67e849fb42c',
  sql,
} as const
