const sql = `CREATE SCHEMA replay_analysis;

CREATE TABLE replay_analysis.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  replay_bytes bytea CHECK (octet_length(replay_bytes) BETWEEN 1 AND 16777216),
  replay_digest varchar(71) NOT NULL CHECK (replay_digest ~ '^sha256:[0-9a-f]{64}$'),
  file_name varchar(255),
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result jsonb,
  failure jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'completed') = (result IS NOT NULL)),
  CHECK ((status = 'failed') = (failure IS NOT NULL)),
  CHECK ((status IN ('pending', 'processing')) = (replay_bytes IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL))
);

CREATE INDEX replay_analysis_jobs_account_created_idx
  ON replay_analysis.jobs (account_id, created_at DESC);
CREATE UNIQUE INDEX replay_analysis_jobs_one_active_per_account_idx
  ON replay_analysis.jobs (account_id)
  WHERE status IN ('pending', 'processing');
CREATE INDEX replay_analysis_jobs_claim_idx
  ON replay_analysis.jobs (created_at)
  WHERE status IN ('pending', 'processing');
`

export const createReplayJobs = {
  identity: 'replay-analysis/0001',
  predecessor: null,
  checksum: '3e88ebeecf8b0f1c213fbe7197473e62064387cc8da758f02906a165b4680eb8',
  sql,
} as const
