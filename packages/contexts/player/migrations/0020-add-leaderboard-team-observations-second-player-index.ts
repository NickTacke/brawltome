// Ranked profiles look up a player's fixed teams on either side of the pair; the primary key only covers the lower id.
const sql = `SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS players_leaderboard_team_observations_second_player
  ON players.leaderboard_team_observations (brawlhalla_id_two);`

export const addLeaderboardTeamObservationsSecondPlayerIndex = {
  identity: 'players/0020',
  predecessor: 'players/0019',
  checksum: '20b4d073d51bf6d0b8482a24fb389bdf39c2c88d2b17ce6b8e11932045131bf3',
  sql,
} as const
