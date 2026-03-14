ALTER TABLE "ranked_2v2_team" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ranked_2v2_team" CASCADE;--> statement-breakpoint
CREATE INDEX "idx_ranked_team_rating" ON "player_ranked_team" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_ranked_team_region_rating" ON "player_ranked_team" USING btree ("region","rating");