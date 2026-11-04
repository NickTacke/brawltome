const sql = `SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION rankings.expire_v1_generations(cutoff timestamptz, max_generations integer)
RETURNS TABLE (deleted_generations integer, expirable_generations integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
-- Only a bitmap scan reads just the expired rows' heap pages, in physical order. The planner underestimates
-- distinct snapshot ids (17k sampled vs 120k real), so it costs a batch at ~7M rows and, because a DELETE cannot run
-- in parallel, chose a full sequential scan of the 29 GB heap for every batch in production.
SET enable_indexscan = off
SET enable_seqscan = off
AS $$
DECLARE
  expired uuid[];
  expired_snapshots uuid[];
  eligible_count integer;
  deleted integer;
BEGIN
  -- 24 hours is the decided retention policy; no configuration may expire anything younger.
  IF cutoff IS NULL OR cutoff > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'ranking retention cutoff must be at least 24 hours in the past';
  END IF;
  IF max_generations IS NULL OR max_generations < 1 OR max_generations > 200 THEN
    RAISE EXCEPTION 'ranking retention batch must be between 1 and 200';
  END IF;

  -- schedule_window_at is the publication's identity in time: readers pick the latest generation and the Queue
  -- partner by it, and it is indexed. The newest two finalized V1 generations per mode survive any outage.
  WITH newest AS (
    SELECT ranked.id
    FROM (
      SELECT generation.id,
             row_number() OVER (
               PARTITION BY generation.mode
               ORDER BY generation.schedule_window_at DESC, generation.id DESC
             ) AS recency
      FROM rankings.generations generation
      WHERE generation.source = 'brawlhalla-v1-ranked-leaderboard'
        AND generation.finalized
    ) ranked
    WHERE ranked.recency <= 2
  ), eligible AS (
    SELECT generation.id
    FROM rankings.generations generation
    WHERE generation.source = 'brawlhalla-v1-ranked-leaderboard'
      AND generation.finalized
      AND generation.schedule_window_at < cutoff
      AND generation.id NOT IN (SELECT newest.id FROM newest)
      AND NOT EXISTS (
        SELECT 1 FROM rankings.legacy_import_sets legacy_set WHERE legacy_set.generation_id = generation.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM rankings.legacy_import_sets legacy_set
        JOIN rankings.snapshots snapshot ON snapshot.id = legacy_set.snapshot_id
        WHERE snapshot.generation_id = generation.id
      )
  ), batch AS (
    SELECT generation.id
    FROM rankings.generations generation
    WHERE generation.id IN (SELECT eligible.id FROM eligible)
    ORDER BY generation.schedule_window_at, generation.id
    LIMIT max_generations
    FOR UPDATE OF generation SKIP LOCKED
  )
  SELECT coalesce((SELECT array_agg(batch.id) FROM batch), ARRAY[]::uuid[]),
         (SELECT count(*)::integer FROM eligible)
  INTO expired, eligible_count;

  IF cardinality(expired) = 0 THEN
    deleted_generations := 0;
    expirable_generations := eligible_count;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT array_agg(snapshot.id) INTO expired_snapshots
  FROM rankings.snapshots snapshot
  WHERE snapshot.generation_id = ANY(expired);

  PERFORM set_config('rankings.retention_delete', 'on', true);
  -- Snapshot ids are unique and each snapshot has exactly one mode, so the id alone selects its rows. A generation
  -- without snapshots leaves the array null, which matches nothing.
  DELETE FROM rankings.snapshot_rows WHERE snapshot_id = ANY(expired_snapshots);
  DELETE FROM rankings.snapshots snapshot WHERE snapshot.generation_id = ANY(expired);
  DELETE FROM rankings.generations generation WHERE generation.id = ANY(expired);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  PERFORM set_config('rankings.retention_delete', 'off', true);
  -- What is still past the window after this batch (including rows a concurrent call holds) feeds the backlog gauge.
  deleted_generations := deleted;
  expirable_generations := greatest(eligible_count - deleted, 0);
  RETURN NEXT;
END;
$$;`

export const retentionDeleteWithoutSeqScan = {
  identity: 'rankings/0011',
  predecessor: 'rankings/0010',
  checksum: '20fc8c975cd8b9000f43bcbdcf231abf7d65490dc153ed41ff56ddb99734c228',
  sql,
} as const
