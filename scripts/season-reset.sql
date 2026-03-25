-- Season Reset Script
-- Run via: psql -h localhost -p 5432 -U <user> -d <db> -f scripts/season-reset.sql
-- Requires SSH tunnel to production: ssh -L 5432:localhost:5432 <vps>

BEGIN;

-- 1. Snapshot final elo to rating_history for recently active players
INSERT INTO rating_history (brawlhalla_id, rating, peak_rating, tier, games, wins, recorded_at)
SELECT brawlhalla_id, rating, peak_rating, tier, ranked_games, ranked_wins, NOW()
FROM player
WHERE ranked_last_updated >= NOW() - INTERVAL '7 days'
  AND rating > 0;

-- 2. Wipe player ranked fields
UPDATE player SET
  rating = 0,
  peak_rating = 0,
  tier = NULL,
  ranked_games = 0,
  ranked_wins = 0,
  best_legend = NULL,
  best_legend_games = 0,
  best_legend_wins = 0,
  valhallan_confirmed_at = NULL;

-- 3. Delete all ranked legend data
DELETE FROM player_ranked_legend;

-- 4. Delete all ranked team data
DELETE FROM player_ranked_team;

COMMIT;
