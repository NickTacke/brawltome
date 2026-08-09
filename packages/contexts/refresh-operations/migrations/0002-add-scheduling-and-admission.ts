const sql = `ALTER TABLE refresh_operations.operations
  ADD COLUMN work_class text NOT NULL DEFAULT 'interactive'
    CHECK (work_class IN (
      'interactive',
      'primary-monitoring',
      'leaderboard',
      'global-statistics',
      'projection',
      'maintenance'
    ));

DROP INDEX refresh_operations.refresh_operations_due;
CREATE INDEX refresh_operations_due
  ON refresh_operations.operations (work_class, available_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX refresh_operations_active_class
  ON refresh_operations.operations (work_class, lease_expires_at)
  WHERE status = 'leased';

CREATE TABLE refresh_operations.schedules (
  id uuid PRIMARY KEY,
  schedule_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind = 'proof'),
  work_class text NOT NULL CHECK (work_class IN (
    'interactive',
    'primary-monitoring',
    'leaderboard',
    'global-statistics',
    'projection',
    'maintenance'
  )),
  interval_ms bigint NOT NULL CHECK (interval_ms > 0),
  first_due_at timestamptz NOT NULL,
  next_window_number bigint NOT NULL DEFAULT 0 CHECK (next_window_number >= 0),
  next_due_at timestamptz NOT NULL,
  operation_key_prefix text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version = 1),
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (next_due_at >= first_due_at)
);
CREATE INDEX refresh_operations_due_schedules
  ON refresh_operations.schedules (next_due_at, id)
  WHERE enabled;

CREATE TABLE refresh_operations.schedule_occurrences (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES refresh_operations.schedules(id),
  operation_id uuid NOT NULL UNIQUE REFERENCES refresh_operations.operations(id),
  first_window_number bigint NOT NULL CHECK (first_window_number >= 0),
  last_window_number bigint NOT NULL CHECK (last_window_number >= first_window_number),
  window_due_at timestamptz NOT NULL,
  materialized_at timestamptz NOT NULL,
  lateness_ms bigint NOT NULL CHECK (lateness_ms >= 0),
  missed_window_count bigint NOT NULL CHECK (missed_window_count >= 0),
  catch_up boolean NOT NULL,
  UNIQUE (schedule_id, first_window_number),
  UNIQUE (schedule_id, window_due_at),
  CHECK (last_window_number - first_window_number = missed_window_count),
  CHECK (catch_up = (missed_window_count > 0))
);
CREATE INDEX refresh_operations_schedule_history
  ON refresh_operations.schedule_occurrences (schedule_id, window_due_at DESC);

CREATE TABLE refresh_operations.admission_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  config_hash text NOT NULL,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE refresh_operations.admission_classes (
  work_class text PRIMARY KEY CHECK (work_class IN (
    'primary-monitoring',
    'leaderboard',
    'global-statistics',
    'projection',
    'maintenance'
  )),
  credit bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);`

export const addSchedulingAndAdmission = {
  identity: 'refresh-operations/0002',
  predecessor: 'refresh-operations/0001',
  checksum: 'eeb157f26cb2e5a263953f7405ff908beaa65b3dd368a73d4b480e822b3a3dbd',
  sql,
} as const
