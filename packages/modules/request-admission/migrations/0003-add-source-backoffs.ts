const sql = `CREATE TABLE request_admission.source_backoffs (
  domain text PRIMARY KEY,
  paused_until timestamptz NOT NULL,
  last_admitted_at timestamptz
);

CREATE INDEX source_reservations_admitted_at_idx
  ON request_admission.source_reservations (domain, admitted_at);

CREATE INDEX actor_windows_started_at_idx
  ON request_admission.actor_windows (window_started_at);

CREATE INDEX actor_reservations_admitted_at_idx
  ON request_admission.actor_reservations (admitted_at);`

export const addSourceBackoffs = {
  identity: 'request-admission/0003',
  predecessor: 'request-admission/0002',
  checksum: '0e7d172eafebf9b33a78353469a5c5d05f2f7cae8994a9e9189476eee02fe0ed',
  sql,
} as const
