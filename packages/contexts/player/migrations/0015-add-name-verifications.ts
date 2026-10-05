const sql = `ALTER TABLE players.leaderboard_name_observations ADD COLUMN previous_player_name text;

-- Equal, or one is the other's UTF-8 bytes read as Latin-1 (see decodeV0CareerNameCandidate).
CREATE FUNCTION players.names_match(left_name text, right_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT left_name = right_name
    OR left_name = convert_from(convert_to(right_name, 'UTF8'), 'LATIN1')
    OR right_name = convert_from(convert_to(left_name, 'UTF8'), 'LATIN1')
$$;

CREATE TABLE players.name_verifications (
  brawlhalla_id integer NOT NULL CHECK (brawlhalla_id > 0),
  player_name text NOT NULL,
  v0_name text NOT NULL,
  v0_observed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'renamed', 'confirmed_stale', 'failed')),
  spent boolean NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  PRIMARY KEY (brawlhalla_id, player_name)
);

CREATE INDEX name_verifications_spent_checked_at ON players.name_verifications (checked_at) WHERE spent;`

export const addNameVerifications = {
  identity: 'players/0015',
  predecessor: 'players/0014',
  checksum: 'c73923be344992353473032c8205548d397300da7497bcabe5bf557ed30b6431',
  sql,
} as const
