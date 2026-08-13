const sql = `CREATE TABLE players.ranked_profiles (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text,
  checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  region text,
  rating integer CHECK (rating >= 0),
  peak_rating integer CHECK (peak_rating >= 0),
  tier text,
  wins integer CHECK (wins >= 0),
  games integer CHECK (games >= 0),
  global_rank integer CHECK (global_rank > 0),
  region_rank integer CHECK (region_rank > 0),
  ranked_main_legend_id integer CHECK (ranked_main_legend_id > 0),
  ranked_main_legend_name_key text,
  CHECK (
    (last_success_at IS NULL AND player_name IS NULL AND region IS NULL AND rating IS NULL
      AND peak_rating IS NULL AND tier IS NULL AND wins IS NULL AND games IS NULL)
    OR
    (last_success_at IS NOT NULL AND player_name IS NOT NULL AND region IS NOT NULL AND rating IS NOT NULL
      AND peak_rating IS NOT NULL AND tier IS NOT NULL AND wins IS NOT NULL AND games IS NOT NULL)
  ),
  CHECK ((ranked_main_legend_id IS NULL) = (ranked_main_legend_name_key IS NULL))
);

CREATE TABLE players.ranked_legends (
  brawlhalla_id integer NOT NULL REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  legend_id integer NOT NULL CHECK (legend_id > 0),
  legend_name_key text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text NOT NULL,
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= 0),
  PRIMARY KEY (brawlhalla_id, legend_id),
  UNIQUE (brawlhalla_id, ordinal)
);

CREATE TABLE players.ranked_fixed_teams (
  brawlhalla_id integer NOT NULL REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  brawlhalla_id_one integer NOT NULL CHECK (brawlhalla_id_one > 0),
  brawlhalla_id_two integer NOT NULL CHECK (brawlhalla_id_two > 0),
  team_name text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text NOT NULL,
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= 0),
  region text NOT NULL,
  global_rank integer CHECK (global_rank > 0),
  PRIMARY KEY (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two),
  UNIQUE (brawlhalla_id, ordinal),
  CHECK (brawlhalla_id = brawlhalla_id_one OR brawlhalla_id = brawlhalla_id_two)
);

CREATE TABLE players.ranked_solo_queue (
  brawlhalla_id integer NOT NULL REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  second_player_id integer NOT NULL DEFAULT 0 CHECK (second_player_id = 0),
  team_name text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text NOT NULL,
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= 0),
  region text NOT NULL,
  global_rank integer CHECK (global_rank > 0),
  PRIMARY KEY (brawlhalla_id, ordinal)
);

CREATE TABLE players.ranked_rating_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brawlhalla_id integer NOT NULL REFERENCES players.ranked_profiles(brawlhalla_id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating > 0),
  peak_rating integer NOT NULL CHECK (peak_rating >= 0),
  tier text NOT NULL,
  wins integer NOT NULL CHECK (wins >= 0),
  games integer NOT NULL CHECK (games >= 0),
  recorded_at timestamptz NOT NULL
);

CREATE INDEX ranked_rating_history_player_time
  ON players.ranked_rating_history (brawlhalla_id, recorded_at DESC, id DESC);`

export const addCanonicalRankedState = {
  identity: 'players/0003',
  predecessor: 'players/0002',
  checksum: 'dfad48739d880c7e48b92d47968549ffa18800969d64709b4700e1a1bddf870c',
  sql,
} as const
