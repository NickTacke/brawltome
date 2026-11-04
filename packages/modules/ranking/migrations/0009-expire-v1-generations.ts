const sql = `SET LOCAL lock_timeout = '5s';

CREATE FUNCTION rankings.retention_delete_authorized(relation oid) RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Only the definer-rights retention function sets this, and it runs as the table owner. Any other role that
  -- forges the transaction-local setting still fails the owner check.
  RETURN coalesce(pg_catalog.current_setting('rankings.retention_delete', true), '') = 'on'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class relation_class
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = relation_class.relowner
      WHERE relation_class.oid = relation
        AND owner_role.rolname = current_user
    );
END;
$$;

CREATE OR REPLACE FUNCTION rankings.reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND rankings.retention_delete_authorized(TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published ranking snapshots are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION rankings.reject_generation_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT OLD.finalized AND NEW.finalized THEN
    NEW.finalized := false;
    IF NEW IS NOT DISTINCT FROM OLD THEN
      NEW.finalized := true;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND rankings.retention_delete_authorized(TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published ranking snapshots are immutable';
END;
$$;

CREATE FUNCTION rankings.expire_v1_generations(cutoff timestamptz, max_generations integer)
RETURNS TABLE (deleted_generations integer, expirable_generations integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  expired uuid[];
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

  PERFORM set_config('rankings.retention_delete', 'on', true);
  DELETE FROM rankings.snapshot_rows row
  USING rankings.snapshots snapshot
  WHERE snapshot.generation_id = ANY(expired)
    AND row.snapshot_id = snapshot.id
    AND row.mode = snapshot.mode;
  DELETE FROM rankings.snapshots snapshot WHERE snapshot.generation_id = ANY(expired);
  DELETE FROM rankings.generations generation WHERE generation.id = ANY(expired);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  PERFORM set_config('rankings.retention_delete', 'off', true);
  -- What is still past the window after this batch (including rows a concurrent call holds) feeds the backlog gauge.
  deleted_generations := deleted;
  expirable_generations := greatest(eligible_count - deleted, 0);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION rankings.expire_v1_generations(timestamptz, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'brawltome_runtime') THEN
    GRANT EXECUTE ON FUNCTION rankings.expire_v1_generations(timestamptz, integer) TO brawltome_runtime;
  END IF;
END;
$$;`

export const expireV1RankingGenerations = {
  identity: 'rankings/0009',
  predecessor: 'rankings/0008',
  checksum: 'f39239ec2b509286ed3b52338a0d264da2415c9e02ac4557085874aa99da992f',
  sql,
} as const
