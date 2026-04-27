CREATE TABLE "player_rank_1v1" (
	"brawlhalla_id" integer NOT NULL,
	"region" varchar(16) NOT NULL,
	"rank" integer NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_rank_1v1_brawlhalla_id_region_pk" PRIMARY KEY("brawlhalla_id","region")
);
--> statement-breakpoint
ALTER TABLE "player_ranked_team" ADD COLUMN "synced_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "player_rank_1v1" ADD CONSTRAINT "player_rank_1v1_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_rank_1v1_region_rank" ON "player_rank_1v1" USING btree ("region","rank");--> statement-breakpoint
CREATE INDEX "idx_player_rank_1v1_synced_at" ON "player_rank_1v1" USING btree ("synced_at");