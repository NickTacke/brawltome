const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE rankings.snapshot_rows
  DROP CONSTRAINT snapshot_rows_contestants_check,
  ADD CONSTRAINT snapshot_rows_contestants_check CHECK (
    player_one_id > 0
    AND length(player_one_name) > 0
    AND (
      (identity_kind = 'fixed-two-vs-two-team'
        AND player_two_id IS NOT NULL
        AND player_two_id >= player_one_id
        AND player_two_name IS NOT NULL
        AND length(player_two_name) > 0
        AND (player_two_id > player_one_id OR player_two_name <> player_one_name))
      OR
      (identity_kind <> 'fixed-two-vs-two-team'
        AND player_two_id IS NULL
        AND player_two_name IS NULL)
    )
  );`

export const supportCouchLeaderboardTeams = {
  identity: 'rankings/0006',
  predecessor: 'rankings/0005',
  checksum: '717faa9c502f8fdef88f8876680193385e02caa14cba7a7bb869a43f848acf73',
  sql,
} as const
