// leaderboard effects and deep-crawl progress move to their owner; the release still serving and a rollback to it keep
// the old names through views and a wrapper function until a later release drops them. the three tables lock access
// exclusive, always in this order, for this short transaction; nothing here locks refresh_operations.operations, so a
// running worker can't deadlock with the migration. the record function's body is recreated because plpgsql stores the
// old schema as text
const sql = `SET LOCAL lock_timeout = '5s';

LOCK TABLE
  refresh_operations.leaderboard_effects,
  refresh_operations.leaderboard_deep_crawl_progress,
  refresh_operations.leaderboard_deep_crawl_mode_progress
IN ACCESS EXCLUSIVE MODE;

ALTER TABLE refresh_operations.leaderboard_effects SET SCHEMA rankings;
ALTER TABLE refresh_operations.leaderboard_deep_crawl_progress SET SCHEMA rankings;
ALTER TABLE refresh_operations.leaderboard_deep_crawl_mode_progress SET SCHEMA rankings;

CREATE VIEW refresh_operations.leaderboard_effects AS
  SELECT operation_key, operation_id, operation_kind, lease_token, created_at FROM rankings.leaderboard_effects;
CREATE VIEW refresh_operations.leaderboard_deep_crawl_progress AS
  SELECT region, window_at, next_page, total_pages, updated_at FROM rankings.leaderboard_deep_crawl_progress;
CREATE VIEW refresh_operations.leaderboard_deep_crawl_mode_progress AS
  SELECT mode, region, window_at, next_page, total_pages, updated_at FROM rankings.leaderboard_deep_crawl_mode_progress;

ALTER FUNCTION refresh_operations.record_leaderboard_effect(uuid, text, text, text, bigint) SET SCHEMA rankings;

CREATE OR REPLACE FUNCTION rankings.record_leaderboard_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_operation_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  operation_active boolean;
  effect_operation_id uuid;
  existing rankings.leaderboard_effects%ROWTYPE;
BEGIN
  SELECT operation.effect_operation_id INTO effect_operation_id
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  IF effect_operation_id IS NULL THEN
    RETURN 'lease-lost';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_key, 201));

  SELECT * INTO existing
  FROM rankings.leaderboard_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = effect_operation_id
      AND existing.operation_key = p_operation_key
      AND existing.operation_kind = p_operation_kind THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  SELECT true INTO operation_active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
    AND operation.kind = p_operation_kind
    AND operation.kind IN (
      'leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'
    )
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp();

  IF NOT coalesce(operation_active, false) THEN
    RETURN 'lease-lost';
  END IF;

  INSERT INTO rankings.leaderboard_effects
    (operation_key, operation_id, operation_kind, lease_token)
  VALUES (p_operation_key, effect_operation_id, p_operation_kind, p_lease_token);
  RETURN 'applied';
END;
$$;

CREATE FUNCTION refresh_operations.record_leaderboard_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_operation_kind text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT rankings.record_leaderboard_effect($1, $2, $3, $4, $5);
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brawltome_dead_letter') THEN
    GRANT USAGE ON SCHEMA rankings TO brawltome_dead_letter;
    GRANT SELECT ON refresh_operations.leaderboard_effects TO brawltome_dead_letter;
  END IF;
END;
$$;`

export const moveEffectTables = {
  identity: 'rankings/0013',
  predecessor: 'rankings/0012',
  requires: ['refresh-operations/0028'],
  checksum: '9af11638353deadbe200fbf066a5d4a06336d4f8819908b5338473e79f7ed091',
  sql,
} as const
