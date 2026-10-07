const sql = `SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS players_career_legends_best_order
  ON players.career_legends (brawlhalla_id, xp DESC, level DESC, ordinal) INCLUDE (legend_name_key);

ANALYZE players.career_legends;`

export const addCareerLegendsBestOrderIndex = {
  identity: 'players/0016',
  predecessor: 'players/0015',
  checksum: 'af40bb2b812b4e4d299d58aeab6b786eb4e7f5f50f205f2ff2baeeed83cce0fa',
  sql,
} as const
