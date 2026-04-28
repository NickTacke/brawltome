-- Drop rows beyond new cap (40 API pages × 50 = rank 2000)
DELETE FROM "player_rank_1v1" WHERE "rank" > 2000;
DELETE FROM "player_ranked_team" WHERE "global_rank" > 2000;
--> statement-breakpoint

-- Drop lowercase region rows (regional ghosts; 'all' stays lowercase)
DELETE FROM "player_rank_1v1" WHERE "region" <> 'all' AND "region" <> upper("region");
DELETE FROM "player_ranked_team" WHERE "region" <> 'all' AND "region" <> upper("region");
--> statement-breakpoint

-- CHECK constraints to prevent recurrence
ALTER TABLE "player_rank_1v1"
  ADD CONSTRAINT "player_rank_1v1_region_canonical"
  CHECK ("region" = 'all' OR "region" = upper("region"));
--> statement-breakpoint

ALTER TABLE "player_ranked_team"
  ADD CONSTRAINT "player_ranked_team_region_canonical"
  CHECK ("region" = 'all' OR "region" = upper("region"));
