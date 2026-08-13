export const legacyClanRankingSchemaSql = `
CREATE TABLE public.clan (
  clan_id integer PRIMARY KEY,
  clan_name text NOT NULL,
  clan_create_date timestamp NOT NULL,
  clan_xp bigint NOT NULL,
  clan_lifetime_xp bigint NOT NULL,
  last_updated timestamp NOT NULL
);
CREATE TABLE public.clan_member (
  clan_id integer NOT NULL REFERENCES public.clan(clan_id) ON DELETE CASCADE,
  brawlhalla_id integer NOT NULL,
  name text NOT NULL,
  rank text NOT NULL,
  join_date timestamp NOT NULL,
  xp integer NOT NULL,
  legend_name_key text,
  PRIMARY KEY (clan_id, brawlhalla_id)
);
CREATE TABLE public.player (
  brawlhalla_id integer PRIMARY KEY,
  name text NOT NULL,
  region text,
  rating integer NOT NULL DEFAULT 0,
  peak_rating integer,
  tier text,
  ranked_games integer NOT NULL DEFAULT 0,
  ranked_wins integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  synced_at_1v1 timestamp,
  rating_3v3 integer NOT NULL DEFAULT 0,
  peak_rating_3v3 integer NOT NULL DEFAULT 0,
  tier_3v3 text,
  wins_3v3 integer NOT NULL DEFAULT 0,
  losses_3v3 integer NOT NULL DEFAULT 0,
  synced_at_3v3 timestamp
);
CREATE TABLE public.player_clan (
  brawlhalla_id integer PRIMARY KEY REFERENCES public.player(brawlhalla_id) ON DELETE CASCADE,
  clan_name text NOT NULL,
  clan_id integer NOT NULL,
  clan_xp bigint NOT NULL,
  clan_lifetime_xp bigint NOT NULL,
  personal_xp integer NOT NULL
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
  synced_at timestamp NOT NULL,
  PRIMARY KEY (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, region)
);
`

export const legacyClanRankingRowsSql = `
INSERT INTO public.clan VALUES
  (1, 'Archive Keepers', '2020-01-01 00:00:00', 1000, 5000, '2026-08-01 10:00:00'),
  (2, 'Conflict Clan', '2021-01-01 00:00:00', 2000, 6000, '2026-08-01 11:00:00'),
  (-3, 'Invalid Identity', '2022-01-01 00:00:00', 1, 1, '2026-08-01 12:00:00');

INSERT INTO public.player
  (brawlhalla_id, name, region, rating, peak_rating, tier, ranked_games, ranked_wins, synced_at_1v1,
   rating_3v3, peak_rating_3v3, tier_3v3, wins_3v3, losses_3v3, synced_at_3v3)
VALUES
  (10, 'Alpha', 'EU', 1900, 1950, 'Platinum', 100, 60, '2026-08-01 10:00:00',
   1800, 1850, 'Platinum', 30, 20, '2026-08-01 10:01:00'),
  (11, 'Bravo', 'EU', 1800, 1850, 'Platinum', 80, 40, '2026-08-01 10:05:00',
   1700, 1750, 'Gold', 20, 20, '2026-08-01 10:06:00'),
  (12, 'Charlie', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (13, 'Delta', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (14, 'Echo', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (20, 'Invalid Peak', 'US-E', 1900, 1800, 'Platinum', 20, 10, '2026-08-01 10:00:00',
   0, 0, NULL, 0, 0, NULL),
  (21, 'Foxtrot', 'US-E', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (22, 'Golf', 'US-E', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (30, 'Orphan Membership', 'EU', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL),
  (40, 'Tie One', 'AUS', 1700, 1750, 'Gold', 30, 10, '2026-08-01 10:00:00',
   0, 0, NULL, 0, 0, NULL),
  (41, 'Tie Two', 'AUS', 1700, 1760, 'Gold', 30, 10, '2026-08-01 10:01:00',
   0, 0, NULL, 0, 0, NULL),
  (42, 'Window One', 'JPN', 1650, 1700, 'Gold', 20, 9, '2026-08-01 10:00:00',
   0, 0, NULL, 0, 0, NULL),
  (43, 'Window Two', 'JPN', 1600, 1650, 'Gold', 20, 8, '2026-08-01 10:20:01',
   0, 0, NULL, 0, 0, NULL),
  (44, '   ', 'SEA', 0, 0, NULL, 0, 0, NULL, 0, 0, NULL, 0, 0, NULL);

INSERT INTO public.clan_member VALUES
  (1, 10, 'Alpha', 'Leader', '2020-01-02 00:00:00', 500, 'bodvar'),
  (2, 20, 'Invalid Peak', 'Member', '2021-01-02 00:00:00', 200, NULL),
  (-3, 21, 'Foxtrot', 'Leader', '2022-01-02 00:00:00', 1, NULL);

INSERT INTO public.player_clan VALUES
  (10, 'Archive Keepers', 1, 1000, 5000, 500),
  (20, 'Conflict Clan', 2, 2000, 6000, 999),
  (30, 'Missing Clan', 999, 1, 1, 1);

INSERT INTO public.player_ranked_team VALUES
  (12, 12, 13, 'Charlie + Delta', 1850, 1900, 'Platinum', 30, 50, 'EU', '2026-08-01 10:02:00'),
  (13, 12, 13, 'Charlie + Delta', 1850, 1900, 'Platinum', 30, 50, 'EU', '2026-08-01 10:03:00'),
  (14, 14, 0, 'Solo Queue', 1750, 1800, 'Gold', 20, 40, 'EU', '2026-08-01 10:04:00'),
  (21, 21, 22, 'Incomplete Pair', 1600, 1650, 'Gold', 10, 20, 'US-E', '2026-08-01 10:00:00'),
  (44, 44, 0, 'Unresolved Solo', 1500, 1550, 'Gold', 5, 10, 'SEA', '2026-08-01 10:00:00');
`
