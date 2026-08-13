const sql = `ALTER TABLE players.interactive_refresh_effects
  ADD COLUMN effect_version smallint CHECK (effect_version = 1);

CREATE TABLE players.career_profiles (
  brawlhalla_id integer PRIMARY KEY CHECK (brawlhalla_id > 0),
  player_name text,
  checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  xp integer CHECK (xp >= 0),
  level integer CHECK (level >= 0),
  xp_percentage double precision CHECK (xp_percentage BETWEEN 0 AND 1),
  games integer CHECK (games >= 0),
  wins integer CHECK (wins >= 0),
  CHECK (wins <= games),
  match_time integer CHECK (match_time >= 0),
  damage_bomb numeric CHECK (damage_bomb >= 0),
  damage_mine numeric CHECK (damage_mine >= 0),
  damage_spikeball numeric CHECK (damage_spikeball >= 0),
  damage_sidekick numeric CHECK (damage_sidekick >= 0),
  snowball_hits integer CHECK (snowball_hits >= 0),
  bomb_kos integer CHECK (bomb_kos >= 0),
  mine_kos integer CHECK (mine_kos >= 0),
  spikeball_kos integer CHECK (spikeball_kos >= 0),
  sidekick_kos integer CHECK (sidekick_kos >= 0),
  snowball_kos integer CHECK (snowball_kos >= 0),
  CHECK (
    (last_success_at IS NULL AND player_name IS NULL AND xp IS NULL AND level IS NULL
      AND xp_percentage IS NULL AND games IS NULL AND wins IS NULL AND match_time IS NULL
      AND damage_bomb IS NULL AND damage_mine IS NULL AND damage_spikeball IS NULL
      AND damage_sidekick IS NULL AND snowball_hits IS NULL AND bomb_kos IS NULL
      AND mine_kos IS NULL AND spikeball_kos IS NULL AND sidekick_kos IS NULL AND snowball_kos IS NULL)
    OR
    (last_success_at IS NOT NULL AND player_name IS NOT NULL AND xp IS NOT NULL AND level IS NOT NULL
      AND xp_percentage IS NOT NULL AND games IS NOT NULL AND wins IS NOT NULL AND match_time IS NOT NULL
      AND damage_bomb IS NOT NULL AND damage_mine IS NOT NULL AND damage_spikeball IS NOT NULL
      AND damage_sidekick IS NOT NULL AND snowball_hits IS NOT NULL AND bomb_kos IS NOT NULL
      AND mine_kos IS NOT NULL AND spikeball_kos IS NOT NULL AND sidekick_kos IS NOT NULL AND snowball_kos IS NOT NULL)
  )
);

CREATE TABLE players.career_legends (
  brawlhalla_id integer NOT NULL REFERENCES players.career_profiles(brawlhalla_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  legend_id integer NOT NULL CHECK (legend_id > 0),
  legend_name_key text NOT NULL,
  xp integer NOT NULL CHECK (xp >= 0),
  level integer NOT NULL CHECK (level >= 0),
  xp_percentage double precision NOT NULL CHECK (xp_percentage BETWEEN 0 AND 1),
  games integer NOT NULL CHECK (games >= 0),
  wins integer NOT NULL CHECK (wins >= 0),
  CHECK (wins <= games),
  match_time integer NOT NULL CHECK (match_time >= 0),
  kos integer NOT NULL CHECK (kos >= 0),
  falls integer NOT NULL CHECK (falls >= 0),
  suicides integer NOT NULL CHECK (suicides >= 0),
  team_kos integer NOT NULL CHECK (team_kos >= 0),
  damage_dealt numeric NOT NULL CHECK (damage_dealt >= 0),
  damage_taken numeric NOT NULL CHECK (damage_taken >= 0),
  damage_unarmed numeric NOT NULL CHECK (damage_unarmed >= 0),
  ko_unarmed integer NOT NULL CHECK (ko_unarmed >= 0),
  damage_thrown_item numeric NOT NULL CHECK (damage_thrown_item >= 0),
  ko_thrown_item integer NOT NULL CHECK (ko_thrown_item >= 0),
  damage_gadgets numeric NOT NULL CHECK (damage_gadgets >= 0),
  ko_gadgets integer NOT NULL CHECK (ko_gadgets >= 0),
  damage_weapon_one numeric NOT NULL CHECK (damage_weapon_one >= 0),
  ko_weapon_one integer NOT NULL CHECK (ko_weapon_one >= 0),
  time_held_weapon_one integer NOT NULL CHECK (time_held_weapon_one >= 0),
  damage_weapon_two numeric NOT NULL CHECK (damage_weapon_two >= 0),
  ko_weapon_two integer NOT NULL CHECK (ko_weapon_two >= 0),
  time_held_weapon_two integer NOT NULL CHECK (time_held_weapon_two >= 0),
  PRIMARY KEY (brawlhalla_id, legend_id),
  UNIQUE (brawlhalla_id, ordinal)
);

CREATE TABLE players.career_weapons (
  brawlhalla_id integer NOT NULL REFERENCES players.career_profiles(brawlhalla_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  weapon text NOT NULL,
  held_time integer NOT NULL CHECK (held_time >= 0),
  damage numeric NOT NULL CHECK (damage >= 0),
  kos integer NOT NULL CHECK (kos >= 0),
  PRIMARY KEY (brawlhalla_id, weapon),
  UNIQUE (brawlhalla_id, ordinal)
);`

export const addCanonicalCareerState = {
  identity: 'players/0004',
  predecessor: 'players/0003',
  checksum: '52476706ae067d30e57b1b33beb80254b511adbffb1b4f7c74d1371f5931df7c',
  sql,
} as const
