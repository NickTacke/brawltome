const sql = `CREATE SCHEMA refresh_operations;

CREATE TABLE refresh_operations.operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'proof'),
  dedupe_key text NOT NULL,
  operation_key text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version = 1),
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'succeeded', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('succeeded', 'dead_letter')) = (completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX refresh_operations_active_dedupe
  ON refresh_operations.operations (kind, dedupe_key)
  WHERE status IN ('pending', 'leased');
CREATE INDEX refresh_operations_due
  ON refresh_operations.operations (available_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX refresh_operations_expired_lease
  ON refresh_operations.operations (lease_expires_at)
  WHERE status = 'leased';

CREATE TABLE refresh_operations.attempts (
  operation_id uuid NOT NULL REFERENCES refresh_operations.operations(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  lease_token bigint NOT NULL,
  lease_owner text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('succeeded', 'retry', 'dead_letter', 'lease_expired')),
  error jsonb,
  PRIMARY KEY (operation_id, attempt_number)
);

CREATE TABLE refresh_operations.proof_effects (
  operation_key text PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  lease_token bigint NOT NULL,
  effect_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);`

export const initializeRefreshOperations = {
  identity: 'refresh-operations/0001',
  predecessor: null,
  checksum: '1f32e6322472955d54595762e3089c9adb07ec0727270cbbdd0c5feb5404e4f2',
  sql,
} as const
