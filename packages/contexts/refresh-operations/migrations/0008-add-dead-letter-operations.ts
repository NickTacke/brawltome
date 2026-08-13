const sql = `ALTER TABLE refresh_operations.operations
  ADD COLUMN effect_operation_id uuid,
  ADD COLUMN replayed_from_operation_id uuid REFERENCES refresh_operations.operations(id),
  ADD COLUMN origin_schedule_occurrence_id uuid REFERENCES refresh_operations.schedule_occurrences(id);

UPDATE refresh_operations.operations SET effect_operation_id = id;
UPDATE refresh_operations.operations operation
SET origin_schedule_occurrence_id = occurrence.id
FROM refresh_operations.schedule_occurrences occurrence
WHERE occurrence.operation_id = operation.id;

ALTER TABLE refresh_operations.operations
  ALTER COLUMN effect_operation_id SET NOT NULL,
  ADD CONSTRAINT operations_effect_operation_fk
    FOREIGN KEY (effect_operation_id) REFERENCES refresh_operations.operations(id),
  ADD CONSTRAINT operations_replay_lineage_check
    CHECK (replayed_from_operation_id IS NULL OR replayed_from_operation_id <> id);

CREATE INDEX refresh_operations_replay_lineage
  ON refresh_operations.operations (replayed_from_operation_id)
  WHERE replayed_from_operation_id IS NOT NULL;

CREATE TABLE refresh_operations.dead_letter_actions (
  id uuid PRIMARY KEY,
  target_operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  disposition text NOT NULL CHECK (disposition IN ('replayed', 'discarded')),
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  replay_operation_id uuid UNIQUE REFERENCES refresh_operations.operations(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((disposition = 'replayed') = (replay_operation_id IS NOT NULL))
);
CREATE INDEX refresh_operations_dead_letter_actions_actor
  ON refresh_operations.dead_letter_actions (actor_id, occurred_at DESC);

CREATE FUNCTION refresh_operations.reject_dead_letter_action_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'dead-letter audit actions are immutable';
END;
$$;

CREATE TRIGGER dead_letter_actions_immutable
BEFORE UPDATE OR DELETE ON refresh_operations.dead_letter_actions
FOR EACH ROW EXECUTE FUNCTION refresh_operations.reject_dead_letter_action_mutation();

CREATE TRIGGER dead_letter_actions_truncate_immutable
BEFORE TRUNCATE ON refresh_operations.dead_letter_actions
FOR EACH STATEMENT EXECUTE FUNCTION refresh_operations.reject_dead_letter_action_mutation();

CREATE OR REPLACE FUNCTION refresh_operations.commit_interactive_section_if_owned(
  requested_operation_id uuid,
  requested_lease_owner text,
  requested_lease_token bigint,
  requested_section text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  effect_operation_id uuid;
BEGIN
  SELECT operation.effect_operation_id INTO effect_operation_id
  FROM refresh_operations.operations operation
  WHERE operation.id = requested_operation_id
    AND operation.kind IN ('interactive-player-refresh', 'clan-refresh')
    AND operation.status = 'leased'
    AND operation.lease_owner = requested_lease_owner
    AND operation.lease_token = requested_lease_token
    AND operation.lease_expires_at > clock_timestamp()
  FOR UPDATE;

  IF effect_operation_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
  VALUES (effect_operation_id, requested_section, requested_lease_token)
  ON CONFLICT (operation_id, section) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_operations.record_leaderboard_effect(
  p_operation_id uuid,
  p_operation_key text,
  p_lease_owner text,
  p_lease_token bigint
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  operation_active boolean;
  effect_operation_id uuid;
  existing refresh_operations.leaderboard_effects%ROWTYPE;
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
  FROM refresh_operations.leaderboard_effects effect
  WHERE effect.operation_key = p_operation_key
     OR effect.operation_id = effect_operation_id
  LIMIT 1;

  IF found THEN
    IF existing.operation_id = effect_operation_id
      AND existing.operation_key = p_operation_key THEN
      RETURN 'already-applied';
    END IF;
    RETURN 'effect-conflict';
  END IF;

  SELECT true INTO operation_active
  FROM refresh_operations.operations operation
  WHERE operation.id = p_operation_id
    AND operation.kind = 'leaderboard-1v1'
    AND operation.operation_key = p_operation_key
    AND operation.status = 'leased'
    AND operation.lease_owner = p_lease_owner
    AND operation.lease_token = p_lease_token
    AND operation.lease_expires_at > clock_timestamp();

  IF NOT coalesce(operation_active, false) THEN
    RETURN 'lease-lost';
  END IF;

  INSERT INTO refresh_operations.leaderboard_effects (operation_key, operation_id, lease_token)
  VALUES (p_operation_key, effect_operation_id, p_lease_token);
  RETURN 'applied';
END;
$$;`

export const addDeadLetterOperations = {
  identity: 'refresh-operations/0008',
  predecessor: 'refresh-operations/0007',
  checksum: '4155f341183e7f277b73a12a38eb24b219193a634cb253b583faf875c0c7a282',
  sql,
} as const
