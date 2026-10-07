const sql = `CREATE TABLE players.profile_view_days (
  day date NOT NULL,
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  views integer NOT NULL CHECK (views > 0),
  PRIMARY KEY (day, brawlhalla_id)
);

CREATE INDEX players_profile_view_days_player ON players.profile_view_days (brawlhalla_id, day);`

export const addProfileViewDays = {
  identity: 'players/0018',
  predecessor: 'players/0017',
  checksum: '55940ef9ebe2b564bef85cad514b73b35135478b2d8cd7c43fd2284d8b0915c0',
  sql,
} as const
