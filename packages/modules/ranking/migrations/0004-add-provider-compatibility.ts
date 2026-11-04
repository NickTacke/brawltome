const sql = `SET LOCAL lock_timeout = '5s';

ALTER TABLE rankings.generations
  DROP CONSTRAINT rankings_generation_source_check;
ALTER TABLE rankings.generations
  ADD CONSTRAINT rankings_generation_source_check CHECK (
    (source = 'brawlhalla-v1-ranked-leaderboard' AND source_contract_version IN (1, 2)
      AND page_depth BETWEEN 1 AND 20)
    OR
    (source = 'v2-legacy' AND source_contract_version = 1 AND page_depth IS NULL)
  );`

export const addLeaderboardProviderCompatibility = {
  identity: 'rankings/0004',
  predecessor: 'rankings/0003',
  checksum: 'f016903e4b7c324a6e2d180f269bf5ad76d8205277037e230f84aeb4c450e313',
  sql,
} as const
