export const legacyPlayerSchemaSql = `
CREATE TABLE public.player (
  brawlhalla_id integer PRIMARY KEY,
  name text NOT NULL,
  region text,
  rating integer NOT NULL DEFAULT 0,
  peak_rating integer,
  tier text,
  ranked_games integer NOT NULL DEFAULT 0,
  ranked_wins integer NOT NULL DEFAULT 0,
  ranked_last_updated timestamp,
  best_legend integer DEFAULT 0,
  best_legend_games integer DEFAULT 0,
  best_legend_wins integer DEFAULT 0,
  rating_3v3 integer NOT NULL DEFAULT 0,
  peak_rating_3v3 integer NOT NULL DEFAULT 0,
  tier_3v3 text,
  wins_3v3 integer NOT NULL DEFAULT 0,
  losses_3v3 integer NOT NULL DEFAULT 0,
  synced_at_1v1 timestamp,
  synced_at_3v3 timestamp,
  xp integer,
  level integer,
  xp_percentage real,
  total_games integer,
  total_wins integer,
  match_time_total integer DEFAULT 0,
  damage_bomb bigint,
  damage_mine bigint,
  damage_spikeball bigint,
  damage_sidekick bigint,
  hit_snowball integer,
  ko_bomb integer,
  ko_mine integer,
  ko_spikeball integer,
  ko_sidekick integer,
  ko_snowball integer,
  stats_last_updated timestamp,
  valhallan_confirmed_at timestamp,
  last_updated timestamp NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamp NOT NULL DEFAULT now(),
  refresh_tier text NOT NULL DEFAULT 'cold'
);
CREATE TABLE public.player_alias (
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamp NOT NULL,
  PRIMARY KEY (brawlhalla_id, key)
);
CREATE TABLE public.player_stats_legend (
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  legend_id integer NOT NULL,
  legend_name_key text NOT NULL,
  xp integer NOT NULL,
  level integer NOT NULL,
  xp_percentage real NOT NULL,
  games integer NOT NULL,
  wins integer NOT NULL,
  match_time integer NOT NULL,
  kos integer NOT NULL,
  team_kos integer NOT NULL,
  suicides integer NOT NULL,
  falls integer NOT NULL,
  damage_dealt bigint NOT NULL,
  damage_taken bigint NOT NULL,
  damage_weapon_one bigint NOT NULL,
  damage_weapon_two bigint NOT NULL,
  time_held_weapon_one integer NOT NULL,
  time_held_weapon_two integer NOT NULL,
  ko_weapon_one integer NOT NULL,
  ko_weapon_two integer NOT NULL,
  ko_unarmed integer NOT NULL,
  ko_thrown_item integer NOT NULL,
  ko_gadgets integer NOT NULL,
  damage_unarmed bigint NOT NULL,
  damage_thrown_item bigint NOT NULL,
  damage_gadgets bigint NOT NULL,
  PRIMARY KEY (brawlhalla_id, legend_id)
);
CREATE TABLE public.player_weapon_stat (
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  weapon text NOT NULL,
  time_held integer NOT NULL,
  damage bigint NOT NULL,
  kos integer NOT NULL,
  PRIMARY KEY (brawlhalla_id, weapon)
);
CREATE TABLE public.player_ranked_legend (
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  legend_id integer NOT NULL,
  legend_name_key text NOT NULL,
  rating integer NOT NULL,
  peak_rating integer NOT NULL,
  tier text NOT NULL,
  wins integer NOT NULL,
  games integer NOT NULL,
  PRIMARY KEY (brawlhalla_id, legend_id)
);
CREATE TABLE public.player_ranked_team (
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  brawlhalla_id_one integer NOT NULL,
  brawlhalla_id_two integer NOT NULL,
  team_name text NOT NULL,
  rating integer NOT NULL,
  peak_rating integer NOT NULL,
  tier text NOT NULL,
  wins integer NOT NULL,
  games integer NOT NULL,
  region text NOT NULL,
  valhallan_confirmed_at timestamp,
  synced_at timestamp NOT NULL,
  PRIMARY KEY (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, region)
);
CREATE TABLE public.rating_history (
  id integer PRIMARY KEY,
  brawlhalla_id integer NOT NULL REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  rating integer NOT NULL,
  peak_rating integer NOT NULL,
  tier text,
  games integer NOT NULL,
  wins integer NOT NULL,
  recorded_at timestamp NOT NULL
);
`

export const legacyPlayerRowsSql = `
INSERT INTO public.player
  (brawlhalla_id, name, region, rating, peak_rating, tier, ranked_games, ranked_wins,
   ranked_last_updated, synced_at_1v1, xp, level, xp_percentage, total_games, total_wins, match_time_total,
   damage_bomb, damage_mine, damage_spikeball, damage_sidekick, hit_snowball, ko_bomb,
   ko_mine, ko_spikeball, ko_sidekick, ko_snowball, stats_last_updated, last_updated,
   view_count, last_viewed_at)
VALUES
  (42, 'Legacy | Forty Two', 'US-E', 0, 0, NULL, 0, 0,
   '2026-08-01 10:00:00', '2026-08-01 11:00:00', 5000, 10, 0.25, 200, 100, 0,
   9007199254740993, 0, 0, 0, 0, 10, 0, 0, 0, 0, '2026-08-01 09:00:00',
   '2026-08-01 10:30:00', 9, '2026-08-01 10:30:00'),
  (43, 'Legacy Forty Three', 'EU', 1800, 1900, 'Diamond', 100, 50,
   '2026-08-02 10:00:00', NULL, NULL, NULL, NULL, NULL, NULL, 0,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   '2026-08-02 10:30:00', 3, '2026-08-02 10:30:00');
UPDATE public.player SET valhallan_confirmed_at = '2026-08-01 10:45:00' WHERE brawlhalla_id = 42;
UPDATE public.player SET synced_at_3v3 = '2026-08-02 11:00:00' WHERE brawlhalla_id = 43;
INSERT INTO public.player_alias VALUES
  (42, 'former', 'Former Name', '2026-07-01 00:00:00');
INSERT INTO public.player_stats_legend VALUES
  (42, 3, 'bodvar', 3000, 8, 0.5, 120, 60, 1000, 80, 0, 0, 60,
   50000, 45000, 20000, 10000, 500, 250, 40, 20, 5, 7, 3, 9000, 4000, 7000);
INSERT INTO public.player_weapon_stat VALUES
  (42, 'Hammer', 500, 20000, 40);
INSERT INTO public.player_ranked_legend VALUES
  (43, 3, 'bodvar', 1750, 1850, 'Platinum', 0, 80);
INSERT INTO public.player_ranked_team VALUES
  (42, 42, 0, 'Solo Queue', 1600, 1650, 'Gold', 0, 10, 'US-E', NULL,
   '2026-08-01 11:00:00'),
  (43, 43, 44, 'Forty Three + Partner', 1700, 1800, 'Platinum', 20, 40, 'EU', NULL,
   '2026-08-02 10:00:00');
INSERT INTO public.rating_history VALUES
  (100, 42, 1500, 1500, 'Gold 1', 10, 0, '2026-07-01 00:00:00'),
  (101, 42, 1600, 1600, 'Gold 2', 12, 1, '2026-07-01 00:00:00'),
  (102, 42, 1700, 1700, NULL, 14, 2, '2026-07-02 00:00:00'),
  (103, 43, 1800, 1900, 'Diamond', 100, 50, '2026-08-02 10:00:00');
`
