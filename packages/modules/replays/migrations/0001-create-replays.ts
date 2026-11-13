// uploads point at accounts.users, so this runs after the accounts tables exist
const sql = `CREATE SCHEMA replays;

-- one row per replay file we hold or held; files are shared by every upload with the same bytes
CREATE TABLE replays.replay_files (
  digest varchar(71) PRIMARY KEY CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  patch varchar(16),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE replays.uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  digest varchar(71) NOT NULL REFERENCES replays.replay_files(digest),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  file_name varchar(255),
  by_operator boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'rejected')),
  rejection jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, digest),
  CHECK ((status = 'rejected') = (rejection IS NOT NULL))
);

CREATE INDEX replays_uploads_account_created_idx ON replays.uploads (account_id, created_at DESC);
CREATE INDEX replays_uploads_digest_idx ON replays.uploads (digest);

CREATE TABLE replays.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest varchar(71) NOT NULL REFERENCES replays.replay_files(digest),
  kind varchar(8) NOT NULL CHECK (kind IN ('parse', 'reparse')),
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  failure jsonb,
  build varchar(64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL)),
  CHECK ((status = 'failed') = (failure IS NOT NULL))
);

-- one active job per file, so a second upload of the same bytes joins the first one's job
CREATE UNIQUE INDEX replays_jobs_one_active_per_digest_idx
  ON replays.jobs (digest) WHERE status IN ('pending', 'processing');
CREATE INDEX replays_jobs_claim_idx ON replays.jobs (kind, created_at) WHERE status IN ('pending', 'processing');

CREATE TABLE replays.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest varchar(71) NOT NULL UNIQUE REFERENCES replays.replay_files(digest),
  candidate_key varchar(128) NOT NULL,
  merged_into uuid REFERENCES replays.matches(id),
  patch varchar(16) NOT NULL,
  format smallint NOT NULL,
  build varchar(64) NOT NULL,
  map_id integer NOT NULL,
  map_name varchar(64) NOT NULL,
  mode_name varchar(32) NOT NULL,
  queue varchar(16),
  is_ranked boolean NOT NULL,
  is_custom boolean NOT NULL,
  has_teams boolean NOT NULL,
  has_team_damage boolean NOT NULL,
  stocks smallint,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  winner_team smallint,
  is_reliable boolean NOT NULL,
  failed_checks jsonb NOT NULL,
  unchecked jsonb NOT NULL,
  timeline_key varchar(200),
  played_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  parsed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX replays_matches_candidate_key_idx ON replays.matches (candidate_key);

CREATE TABLE replays.match_players (
  match_id uuid NOT NULL REFERENCES replays.matches(id) ON DELETE CASCADE,
  slot smallint NOT NULL,
  brawlhalla_id bigint NOT NULL,
  name varchar(64) NOT NULL,
  team smallint NOT NULL,
  legend_id integer NOT NULL,
  legend_name varchar(64) NOT NULL,
  damage_dealt double precision NOT NULL,
  damage_taken double precision NOT NULL,
  kos smallint NOT NULL,
  deaths smallint NOT NULL,
  suicides smallint NOT NULL,
  team_kos smallint NOT NULL,
  clashes smallint NOT NULL,
  dodges smallint NOT NULL,
  air_dodges smallint NOT NULL,
  jumps smallint NOT NULL,
  air_jumps smallint NOT NULL,
  dashes smallint NOT NULL,
  dash_jumps smallint NOT NULL,
  time_in_air_ms integer NOT NULL,
  time_on_ground_ms integer NOT NULL,
  time_on_wall_ms integer NOT NULL,
  score integer NOT NULL,
  weapons jsonb NOT NULL,
  PRIMARY KEY (match_id, slot)
);

CREATE INDEX replays_match_players_player_idx ON replays.match_players (brawlhalla_id, match_id);

CREATE TABLE replays.match_uploads (
  match_id uuid NOT NULL REFERENCES replays.matches(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL UNIQUE REFERENCES replays.uploads(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, upload_id)
);
`

export const createReplays = {
  identity: 'replays/0001',
  predecessor: null,
  checksum: 'a53e3fe1f4fc103e40b25812f97f7c3a414a2bf0f2f9759e74d43d12c3d41633',
  requires: ['accounts/0012'],
  sql,
} as const
