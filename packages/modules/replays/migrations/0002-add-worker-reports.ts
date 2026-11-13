const sql = `-- the patches and bh-native builds the replay worker reports when it claims a job
CREATE TABLE replays.worker_reports (
  patch varchar(16) PRIMARY KEY,
  first_reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_reported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE replays.builds (
  build varchar(64) PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- when each maintenance task last ran, so the worker's frequent claims start it at most once a day
CREATE TABLE replays.maintenance (
  name varchar(32) PRIMARY KEY,
  last_run_at timestamptz NOT NULL
);

INSERT INTO replays.maintenance (name, last_run_at) VALUES ('file-cleanup', 'epoch');
`

export const addWorkerReports = {
  identity: 'replays/0002',
  predecessor: 'replays/0001',
  checksum: '6957fcaeb83c70976838fc5938f7260a4046e69e37a729e9dfe30a025538d473',
  sql,
} as const
