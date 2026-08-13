const sql = `CREATE SCHEMA request_admission;

CREATE TABLE request_admission.actor_windows (
  domain text NOT NULL,
  actor_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (domain, actor_key, window_started_at)
);

CREATE TABLE request_admission.source_windows (
  domain text NOT NULL,
  window_started_at timestamptz NOT NULL,
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  PRIMARY KEY (domain, window_started_at)
);

CREATE TABLE request_admission.source_reservations (
  domain text NOT NULL,
  reservation_key text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (domain, reservation_key)
);`

export const initializeRequestAdmission = {
  identity: 'request-admission/0001',
  predecessor: null,
  checksum: 'c5a231d4c495e6fd0077527ca681fc0b9d87acc19ee775b141f6dace81783fff',
  sql,
} as const
