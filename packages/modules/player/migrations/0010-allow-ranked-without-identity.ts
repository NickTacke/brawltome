const sql = `ALTER TABLE players.ranked_profiles
  DROP CONSTRAINT ranked_profiles_check;

ALTER TABLE players.ranked_profiles
  ADD CONSTRAINT ranked_profiles_snapshot_completeness CHECK (
    (last_success_at IS NULL AND player_name IS NULL AND region IS NULL AND rating IS NULL
      AND peak_rating IS NULL AND tier IS NULL AND wins IS NULL AND games IS NULL)
    OR
    (last_success_at IS NOT NULL AND region IS NOT NULL AND rating IS NOT NULL
      AND peak_rating IS NOT NULL AND tier IS NOT NULL AND wins IS NOT NULL AND games IS NOT NULL)
  );`

export const allowRankedWithoutIdentity = {
  identity: 'players/0010',
  predecessor: 'players/0009',
  checksum: '66874b6a280449b5d49c6be381eb4e69a4699a35456361bc835b44093c9c68aa',
  sql,
} as const
