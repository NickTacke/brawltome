const sql = `ALTER TABLE refresh_operations.operations DROP CONSTRAINT operations_kind_check;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_kind_check CHECK (kind IN ('proof', 'interactive-player-refresh'));
ALTER TABLE refresh_operations.operations DROP CONSTRAINT operations_status_check;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_status_check
  CHECK (status IN ('awaiting_admission', 'pending', 'leased', 'succeeded', 'dead_letter'));
ALTER TABLE refresh_operations.operations
  ADD COLUMN reservation_token uuid,
  ADD COLUMN reservation_expires_at timestamptz;
ALTER TABLE refresh_operations.operations
  ADD CONSTRAINT operations_admission_reservation_check CHECK (
    (status = 'awaiting_admission') = (reservation_token IS NOT NULL AND reservation_expires_at IS NOT NULL)
  );
DROP INDEX refresh_operations.refresh_operations_active_dedupe;
CREATE UNIQUE INDEX refresh_operations_active_dedupe
  ON refresh_operations.operations (kind, dedupe_key)
  WHERE status IN ('awaiting_admission', 'pending', 'leased');`

export const addInteractiveRefreshReservations = {
  identity: 'refresh-operations/0003',
  predecessor: 'refresh-operations/0002',
  checksum: '4f5d57a9827939268a0bea1574e9724cc37e93904582288afdfd7d862e639cf2',
  sql,
} as const
