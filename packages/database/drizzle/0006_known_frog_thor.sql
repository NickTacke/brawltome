CREATE TABLE "player_link" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"brawlhalla_id" integer,
	"steam_id" varchar(64) NOT NULL,
	"linked_via" varchar(32) DEFAULT 'steam' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_link" ADD CONSTRAINT "player_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_player_link_brawlhalla" ON "player_link" USING btree ("brawlhalla_id");