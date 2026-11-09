// jobs validate their own kinds and payloads and name their own sections now, so a new job needs no queue migration.
// dropping a check is safe for the release still serving and one rolled back to: both already write only what these
// checks allowed. the trigger function changes first because it casts brawlhallaId, and a row it could not cast would
// fail the dead-letter update claim uses to settle it. each table gets its own migration, because claim and the
// materializer take these tables in opposite orders and one transaction holding two could deadlock with either
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

ALTER TABLE refresh_operations.operations
  DROP CONSTRAINT operations_kind_check,
  DROP CONSTRAINT operations_payload_by_kind;`

export const dropKindConstraints = {
  identity: 'refresh-operations/0029',
  predecessor: 'refresh-operations/0028',
  checksum: 'c25b822d0ef8d97ee4a7f829999d635586e173d919cad0ec7be6f3896adc2954',
  sql,
} as const
