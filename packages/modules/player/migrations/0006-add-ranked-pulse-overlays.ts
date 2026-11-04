const sql = `ALTER TABLE players.ranked_profiles
  ADD COLUMN v0_effect_created_at timestamptz,
  ADD COLUMN v0_effect_operation_id uuid;

UPDATE players.ranked_profiles
SET v0_effect_created_at = last_success_at
WHERE last_success_at IS NOT NULL;

CREATE TABLE players.ranked_v1_pulse_state (
  brawlhalla_id integer PRIMARY KEY REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  rating integer CHECK (rating >= 0),
  peak_rating integer CHECK (peak_rating >= 0),
  wins integer CHECK (wins >= 0),
  games integer CHECK (games >= 0),
  one_vs_one_effect_created_at timestamptz,
  one_vs_one_effect_operation_id uuid,
  CHECK ((one_vs_one_effect_created_at IS NULL) = (one_vs_one_effect_operation_id IS NULL)),
  CHECK (one_vs_one_effect_created_at IS NOT NULL OR
    (rating IS NULL AND peak_rating IS NULL AND wins IS NULL AND games IS NULL))
);

CREATE TABLE players.ranked_v1_fixed_team_pulses (
  brawlhalla_id integer NOT NULL REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  brawlhalla_id_one integer NOT NULL CHECK (brawlhalla_id_one > 0),
  brawlhalla_id_two integer NOT NULL CHECK (brawlhalla_id_two > 0),
  rating integer CHECK (rating >= 0),
  peak_rating integer CHECK (peak_rating >= 0),
  wins integer CHECK (wins >= 0),
  games integer CHECK (games >= 0),
  effect_created_at timestamptz NOT NULL,
  effect_operation_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two),
  CHECK (brawlhalla_id_one < brawlhalla_id_two),
  CHECK (brawlhalla_id = brawlhalla_id_one OR brawlhalla_id = brawlhalla_id_two),
  CHECK (rating IS NOT NULL OR peak_rating IS NOT NULL OR wins IS NOT NULL OR games IS NOT NULL)
);`

export const addRankedPulseOverlays = {
  identity: 'players/0006',
  predecessor: 'players/0005',
  checksum: '8416e791b342e49758d657379e2943e08b55d3d3295652ea3175908fa5eb81d6',
  sql,
} as const
