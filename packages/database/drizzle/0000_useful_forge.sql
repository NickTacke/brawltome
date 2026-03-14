CREATE TYPE "public"."refresh_tier" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TABLE "blacklist" (
	"brawlhalla_id" integer PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clan" (
	"clan_id" integer PRIMARY KEY NOT NULL,
	"clan_name" varchar(256) NOT NULL,
	"clan_create_date" timestamp NOT NULL,
	"clan_xp" bigint NOT NULL,
	"clan_lifetime_xp" bigint NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clan_member" (
	"clan_id" integer NOT NULL,
	"brawlhalla_id" integer NOT NULL,
	"name" varchar(256) NOT NULL,
	"rank" varchar(64) NOT NULL,
	"join_date" timestamp NOT NULL,
	"xp" integer NOT NULL,
	"legend_name_key" varchar(64),
	CONSTRAINT "clan_member_clan_id_brawlhalla_id_pk" PRIMARY KEY("clan_id","brawlhalla_id")
);
--> statement-breakpoint
CREATE TABLE "discord_link" (
	"discord_id" varchar(64) PRIMARY KEY NOT NULL,
	"brawlhalla_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legend" (
	"legend_id" integer PRIMARY KEY NOT NULL,
	"legend_name_key" varchar(64) NOT NULL,
	"bio_name" varchar(128) NOT NULL,
	"bio_aka" varchar(256),
	"bio_quote" text,
	"bio_quote_about_attrib" varchar(256) NOT NULL,
	"bio_quote_from" text,
	"bio_quote_from_attrib" varchar(256),
	"bio_text" text,
	"bot_name" varchar(128),
	"weapon_one" varchar(64) NOT NULL,
	"weapon_two" varchar(64) NOT NULL,
	"strength" varchar(8) NOT NULL,
	"dexterity" varchar(8) NOT NULL,
	"defense" varchar(8) NOT NULL,
	"speed" varchar(8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player" (
	"brawlhalla_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"region" varchar(16),
	"rating" integer DEFAULT 0 NOT NULL,
	"peak_rating" integer DEFAULT 0,
	"tier" varchar(64),
	"valhallan_confirmed_at" timestamp,
	"ranked_games" integer DEFAULT 0 NOT NULL,
	"ranked_wins" integer DEFAULT 0 NOT NULL,
	"ranked_last_updated" timestamp,
	"best_legend" integer DEFAULT 0,
	"best_legend_games" integer DEFAULT 0,
	"best_legend_wins" integer DEFAULT 0,
	"xp" integer,
	"level" integer,
	"xp_percentage" real,
	"total_games" integer,
	"total_wins" integer,
	"match_time_total" integer DEFAULT 0,
	"damage_bomb" bigint,
	"damage_mine" bigint,
	"damage_spikeball" bigint,
	"damage_sidekick" bigint,
	"hit_snowball" integer,
	"ko_bomb" integer,
	"ko_mine" integer,
	"ko_spikeball" integer,
	"ko_sidekick" integer,
	"ko_snowball" integer,
	"stats_last_updated" timestamp,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp DEFAULT now() NOT NULL,
	"refresh_tier" "refresh_tier" DEFAULT 'cold' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_alias" (
	"brawlhalla_id" integer NOT NULL,
	"key" varchar(256) NOT NULL,
	"value" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_alias_brawlhalla_id_key_pk" PRIMARY KEY("brawlhalla_id","key")
);
--> statement-breakpoint
CREATE TABLE "player_clan" (
	"brawlhalla_id" integer PRIMARY KEY NOT NULL,
	"clan_name" varchar(256) NOT NULL,
	"clan_id" integer NOT NULL,
	"clan_xp" bigint NOT NULL,
	"clan_lifetime_xp" bigint NOT NULL,
	"personal_xp" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_ranked_legend" (
	"brawlhalla_id" integer NOT NULL,
	"legend_id" integer NOT NULL,
	"legend_name_key" varchar(64) NOT NULL,
	"rating" integer NOT NULL,
	"peak_rating" integer NOT NULL,
	"tier" varchar(64) NOT NULL,
	"wins" integer NOT NULL,
	"games" integer NOT NULL,
	CONSTRAINT "player_ranked_legend_brawlhalla_id_legend_id_pk" PRIMARY KEY("brawlhalla_id","legend_id")
);
--> statement-breakpoint
CREATE TABLE "player_ranked_team" (
	"brawlhalla_id" integer NOT NULL,
	"brawlhalla_id_one" integer NOT NULL,
	"brawlhalla_id_two" integer NOT NULL,
	"team_name" varchar(256) NOT NULL,
	"rating" integer NOT NULL,
	"peak_rating" integer NOT NULL,
	"tier" varchar(64) NOT NULL,
	"wins" integer NOT NULL,
	"games" integer NOT NULL,
	"region" varchar(16),
	"global_rank" integer,
	CONSTRAINT "player_ranked_team_brawlhalla_id_brawlhalla_id_one_brawlhalla_id_two_pk" PRIMARY KEY("brawlhalla_id","brawlhalla_id_one","brawlhalla_id_two")
);
--> statement-breakpoint
CREATE TABLE "player_stats_legend" (
	"brawlhalla_id" integer NOT NULL,
	"legend_id" integer NOT NULL,
	"legend_name_key" varchar(64) NOT NULL,
	"xp" integer NOT NULL,
	"level" integer NOT NULL,
	"xp_percentage" real NOT NULL,
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"match_time" integer NOT NULL,
	"kos" integer NOT NULL,
	"team_kos" integer NOT NULL,
	"suicides" integer NOT NULL,
	"falls" integer NOT NULL,
	"damage_dealt" bigint NOT NULL,
	"damage_taken" bigint NOT NULL,
	"damage_weapon_one" bigint NOT NULL,
	"damage_weapon_two" bigint NOT NULL,
	"time_held_weapon_one" integer NOT NULL,
	"time_held_weapon_two" integer NOT NULL,
	"ko_weapon_one" integer NOT NULL,
	"ko_weapon_two" integer NOT NULL,
	"ko_unarmed" integer NOT NULL,
	"ko_thrown_item" integer NOT NULL,
	"ko_gadgets" integer NOT NULL,
	"damage_unarmed" bigint NOT NULL,
	"damage_thrown_item" bigint NOT NULL,
	"damage_gadgets" bigint NOT NULL,
	CONSTRAINT "player_stats_legend_brawlhalla_id_legend_id_pk" PRIMARY KEY("brawlhalla_id","legend_id")
);
--> statement-breakpoint
CREATE TABLE "player_weapon_stat" (
	"brawlhalla_id" integer NOT NULL,
	"weapon" varchar(64) NOT NULL,
	"time_held" integer NOT NULL,
	"damage" bigint NOT NULL,
	"kos" integer NOT NULL,
	CONSTRAINT "player_weapon_stat_brawlhalla_id_weapon_pk" PRIMARY KEY("brawlhalla_id","weapon")
);
--> statement-breakpoint
CREATE TABLE "ranked_2v2_team" (
	"region" varchar(16) NOT NULL,
	"brawlhalla_id_one" integer NOT NULL,
	"brawlhalla_id_two" integer NOT NULL,
	"rank" integer NOT NULL,
	"team_name" varchar(256) NOT NULL,
	"rating" integer NOT NULL,
	"peak_rating" integer NOT NULL,
	"tier" varchar(64) NOT NULL,
	"wins" integer NOT NULL,
	"games" integer NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ranked_2v2_team_region_brawlhalla_id_one_brawlhalla_id_two_pk" PRIMARY KEY("region","brawlhalla_id_one","brawlhalla_id_two")
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"brawlhalla_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"peak_rating" integer NOT NULL,
	"tier" varchar(64),
	"games" integer NOT NULL,
	"wins" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clan_member" ADD CONSTRAINT "clan_member_clan_id_clan_clan_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clan"("clan_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_link" ADD CONSTRAINT "discord_link_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_alias" ADD CONSTRAINT "player_alias_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_clan" ADD CONSTRAINT "player_clan_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_ranked_legend" ADD CONSTRAINT "player_ranked_legend_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_ranked_team" ADD CONSTRAINT "player_ranked_team_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats_legend" ADD CONSTRAINT "player_stats_legend_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_weapon_stat" ADD CONSTRAINT "player_weapon_stat_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_brawlhalla_id_player_brawlhalla_id_fk" FOREIGN KEY ("brawlhalla_id") REFERENCES "public"."player"("brawlhalla_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discord_link_bhid" ON "discord_link" USING btree ("brawlhalla_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_legend_name_key" ON "legend" USING btree ("legend_name_key");--> statement-breakpoint
CREATE INDEX "idx_player_name" ON "player" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_player_view_count" ON "player" USING btree ("view_count");--> statement-breakpoint
CREATE INDEX "idx_player_rating" ON "player" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_player_peak_rating" ON "player" USING btree ("peak_rating");--> statement-breakpoint
CREATE INDEX "idx_player_wins" ON "player" USING btree ("ranked_wins");--> statement-breakpoint
CREATE INDEX "idx_player_games" ON "player" USING btree ("ranked_games");--> statement-breakpoint
CREATE INDEX "idx_player_region_rating" ON "player" USING btree ("region","rating");--> statement-breakpoint
CREATE INDEX "idx_player_region_peak_rating" ON "player" USING btree ("region","peak_rating");--> statement-breakpoint
CREATE INDEX "idx_player_region_wins" ON "player" USING btree ("region","ranked_wins");--> statement-breakpoint
CREATE INDEX "idx_player_region_games" ON "player" USING btree ("region","ranked_games");--> statement-breakpoint
CREATE INDEX "idx_alias_key" ON "player_alias" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_2v2_region_rating" ON "ranked_2v2_team" USING btree ("region","rating");--> statement-breakpoint
CREATE INDEX "idx_2v2_region_peak" ON "ranked_2v2_team" USING btree ("region","peak_rating");--> statement-breakpoint
CREATE INDEX "idx_2v2_region_wins" ON "ranked_2v2_team" USING btree ("region","wins");--> statement-breakpoint
CREATE INDEX "idx_2v2_region_games" ON "ranked_2v2_team" USING btree ("region","games");--> statement-breakpoint
CREATE INDEX "idx_2v2_region_rank" ON "ranked_2v2_team" USING btree ("region","rank");--> statement-breakpoint
CREATE INDEX "idx_rating_history_player" ON "rating_history" USING btree ("brawlhalla_id");--> statement-breakpoint
CREATE INDEX "idx_rating_history_time" ON "rating_history" USING btree ("brawlhalla_id","recorded_at");