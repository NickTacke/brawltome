ALTER TABLE "player" ADD COLUMN "rating_3v3" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "peak_rating_3v3" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "tier_3v3" varchar(64);--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "wins_3v3" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "losses_3v3" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "synced_at_1v1" timestamp;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "synced_at_3v3" timestamp;--> statement-breakpoint
CREATE INDEX "idx_player_rating_wins" ON "player" USING btree ("rating","ranked_wins");--> statement-breakpoint
CREATE INDEX "idx_player_region_rating_wins" ON "player" USING btree ("region","rating","ranked_wins");--> statement-breakpoint
CREATE INDEX "idx_player_rating_3v3_wins" ON "player" USING btree ("rating_3v3","wins_3v3");--> statement-breakpoint
CREATE INDEX "idx_player_region_rating_3v3_wins" ON "player" USING btree ("region","rating_3v3","wins_3v3");--> statement-breakpoint
CREATE INDEX "idx_player_synced_at_1v1" ON "player" USING btree ("synced_at_1v1");--> statement-breakpoint
CREATE INDEX "idx_player_synced_at_3v3" ON "player" USING btree ("synced_at_3v3");--> statement-breakpoint
CREATE INDEX "idx_ranked_team_solo_region_rating_wins" ON "player_ranked_team" USING btree ("region","rating","wins") WHERE "player_ranked_team"."brawlhalla_id_two" = 0;