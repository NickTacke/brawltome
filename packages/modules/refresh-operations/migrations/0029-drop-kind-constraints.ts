// jobs validate their own kinds and payloads and name their own sections now, so a new job needs no queue migration.
// dropping a check is safe for the release still serving and one rolled back to: both already write only what these
// checks allowed. the trigger function changes first because it casts brawlhallaId, and a row it could not cast would
// fail the dead-letter update claim uses to settle it. schedules are locked before operations, the order the
// materializer takes them in
const sql = `SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION refresh_operations.notify_player_refresh_settled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'refresh_operations_player_refresh_settled',
    json_build_object(
      'operationId', NEW.id,
      'brawlhallaId', CASE WHEN NEW.payload->>'brawlhallaId' ~ '^[0-9]{1,18}$'
        THEN (NEW.payload->>'brawlhallaId')::bigint END,
      'status', NEW.status
    )::text
  );
  RETURN NULL;
END;
$$;

ALTER TABLE refresh_operations.schedules
  DROP CONSTRAINT schedules_kind_check,
  DROP CONSTRAINT schedules_payload_by_kind;

ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  DROP CONSTRAINT operations_payload_by_kind;

ALTER TABLE refresh_operations.interactive_refresh_effects
  DROP CONSTRAINT interactive_refresh_effects_section_check;`

export const dropKindConstraints = {
  identity: 'refresh-operations/0029',
  predecessor: 'refresh-operations/0028',
  checksum: '9b5e8891cc9cdd72a9fc455d07fb5b88cb0f4d6b3ea9a5284a667dd8a88cc287',
  sql,
} as const
