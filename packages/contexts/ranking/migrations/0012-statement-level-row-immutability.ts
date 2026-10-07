const sql = `SET LOCAL lock_timeout = '5s';

-- Authorization depends only on the transaction and the current role, never on the row, so one check per statement
-- protects exactly as much as one per row. Per row it cost ~35 s of CPU for each million-row retention batch.
DROP TRIGGER snapshot_rows_are_immutable ON rankings.snapshot_rows;
CREATE TRIGGER snapshot_rows_are_immutable
BEFORE DELETE OR UPDATE ON rankings.snapshot_rows
FOR EACH STATEMENT EXECUTE FUNCTION rankings.reject_immutable_change();

-- With sequential scans disabled every plan costs above the JIT thresholds, so each of the batch's foreign key checks
-- was JIT-compiled (~25 ms apiece, ~20 s per batch) for queries that run in well under a millisecond.
ALTER FUNCTION rankings.expire_v1_generations(timestamptz, integer) SET jit = off;`

export const statementLevelRowImmutability = {
  identity: 'rankings/0012',
  predecessor: 'rankings/0011',
  checksum: '27258e8217c7b96ecd635724e3f4dc70073246d7e06cce4200c2ec2bd68b9079',
  sql,
} as const
