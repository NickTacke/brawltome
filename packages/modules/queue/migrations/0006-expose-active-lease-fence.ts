const sql = `CREATE FUNCTION refresh_operations.acquire_active_lease(
  requested_operation_id uuid,
  requested_lease_owner text,
  requested_lease_token bigint
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  active boolean := false;
BEGIN
  SELECT true INTO active
  FROM refresh_operations.operations
  WHERE id = requested_operation_id
    AND status = 'leased'
    AND lease_owner = requested_lease_owner
    AND lease_token = requested_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;

  RETURN coalesce(active, false);
END;
$$;

CREATE FUNCTION refresh_operations.commit_interactive_section_if_owned(
  requested_operation_id uuid,
  requested_lease_owner text,
  requested_lease_token bigint,
  requested_section text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  active boolean := false;
BEGIN
  SELECT true INTO active
  FROM refresh_operations.operations
  WHERE id = requested_operation_id
    AND kind = 'interactive-player-refresh'
    AND status = 'leased'
    AND lease_owner = requested_lease_owner
    AND lease_token = requested_lease_token
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT coalesce(active, false) THEN
    RETURN false;
  END IF;

  INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
  VALUES (requested_operation_id, requested_section, requested_lease_token)
  ON CONFLICT (operation_id, section) DO NOTHING;
  RETURN true;
END;
$$;`

export const exposeActiveLeaseFence = {
  identity: 'refresh-operations/0006',
  predecessor: 'refresh-operations/0005',
  checksum: '9cedc673d6c7508bcb157585e05c7f74854f26b7527f78f1fb58cc72346d7b23',
  sql,
} as const
