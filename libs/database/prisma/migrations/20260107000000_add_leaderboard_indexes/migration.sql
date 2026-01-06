-- Add indexes for leaderboard performance

-- Global leaderboard sorts (no region filter)
CREATE INDEX "Player_peakRating_idx" ON "Player"("peakRating" DESC);
CREATE INDEX "Player_wins_idx" ON "Player"("wins" DESC);
CREATE INDEX "Player_games_idx" ON "Player"("games" DESC);

-- Regional leaderboard (region filter + sort)
CREATE INDEX "Player_region_rating_idx" ON "Player"("region", "rating" DESC);
CREATE INDEX "Player_region_peakRating_idx" ON "Player"("region", "peakRating" DESC);
CREATE INDEX "Player_region_wins_idx" ON "Player"("region", "wins" DESC);
CREATE INDEX "Player_region_games_idx" ON "Player"("region", "games" DESC);

-- Search results secondary sort
CREATE INDEX "Player_viewCount_idx" ON "Player"("viewCount" DESC);

-- PlayerAlias search by key
CREATE INDEX "PlayerAlias_key_idx" ON "PlayerAlias"("key");
