// Announces every terminal transition of a player refresh (succeeded or dead-lettered) on its own channel, so the API
// can push completion to the profile page instead of the page polling. A trigger covers every path that settles an
// operation (completion, failure, admission rejection, lease-expiry reconciliation), and it is expand-only: released
// code neither listens nor depends on it. NOTIFY is delivered when the settling transaction commits.
const sql = `SET LOCAL lock_timeout = '5s';

CREATE FUNCTION refresh_operations.notify_player_refresh_settled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'refresh_operations_player_refresh_settled',
    json_build_object(
      'operationId', NEW.id,
      'brawlhallaId', (NEW.payload->>'brawlhallaId')::bigint,
      'status', NEW.status
    )::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER operations_player_refresh_settled
AFTER UPDATE OF status ON refresh_operations.operations
FOR EACH ROW
WHEN (
  NEW.kind = 'interactive-player-refresh'
  AND NEW.status IN ('succeeded', 'dead_letter')
  AND OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION refresh_operations.notify_player_refresh_settled();`

export const notifyPlayerRefreshSettled = {
  identity: 'refresh-operations/0026',
  predecessor: 'refresh-operations/0025',
  checksum: '654e40c47a4ca2750315ab7c8b52bd9b17358b15f906fa3c5201c6db994d3f09',
  sql,
} as const
