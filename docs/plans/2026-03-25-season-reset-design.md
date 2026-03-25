# Season Reset Design

## Problem

When a Brawlhalla season resets, the API zeroes out all ranked data. BrawlTome's database retains stale pre-reset values until each player is individually refreshed, causing incorrect leaderboards and profile pages.

## Solution

A manual SQL script run against the production database via SSH tunnel.

### Steps (in order)

1. **Snapshot final elo** into `rating_history` for recently active players (`ranked_last_updated` within 7 days, `rating > 0`)
2. **Wipe `player` ranked fields**: `rating`, `peak_rating`, `tier`, `ranked_games`, `ranked_wins`, `best_legend`, `best_legend_games`, `best_legend_wins`, `valhallan_confirmed_at`
3. **Delete all `player_ranked_legend` rows**
4. **Delete all `player_ranked_team` rows**

### What's preserved

- All `rating_history` (including new snapshots)
- Casual stats (`player_stats_legend`, `player_weapon_stat`)
- Clan data
- Player profiles (xp, level, total games/wins, etc.)

### Future work

- Automatic season reset detection (in progress)
- Season tracking table for historical season metadata
