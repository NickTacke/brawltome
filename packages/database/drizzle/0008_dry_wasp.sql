CREATE TYPE "public"."match_event_kind" AS ENUM('ko', 'self_destruct', 'victory_face');--> statement-breakpoint
CREATE TYPE "public"."match_link_source" AS ENUM('overlay_memory');--> statement-breakpoint
CREATE TYPE "public"."match_parse_status" AS ENUM('parsed', 'pending');--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_slug" text NOT NULL,
	"entity_id" integer NOT NULL,
	"timestamp_ms" integer NOT NULL,
	"kind" "match_event_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_slug" text NOT NULL,
	"replay_entity_id" integer NOT NULL,
	"brawlhalla_id" integer,
	"link_source" "match_link_source",
	"display_name" varchar(256) NOT NULL,
	"team" integer NOT NULL,
	"legend_id" integer,
	"costume_id" integer,
	"stance_index" integer,
	"weapon_skin_1" integer,
	"weapon_skin_2" integer,
	"color_scheme_id" integer,
	"companion_id" integer,
	"emitter_id" integer,
	"trail_effect_id" integer,
	"avatar_id" integer,
	"is_bot" integer,
	"final_score" integer
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"slug" text PRIMARY KEY NOT NULL,
	"dedupe_hash" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parse_status" "match_parse_status" DEFAULT 'pending' NOT NULL,
	"format_version" integer,
	"replay_storage_key" text NOT NULL,
	"replay_bytes" integer NOT NULL,
	"game_patch" text,
	"random_seed" bigint,
	"playlist_id" integer,
	"playlist_name" text,
	"online_game" integer,
	"level_id" integer,
	"duration_ms" integer,
	"match_duration_ms" integer,
	"end_of_match_fanfare_id" integer,
	"winner_team" integer,
	"scoring_type_id" integer,
	"detailed_stats_key" text,
	"sim_version" integer,
	"sim_ran_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_slug_matches_slug_fk" FOREIGN KEY ("match_slug") REFERENCES "public"."matches"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_slug_matches_slug_fk" FOREIGN KEY ("match_slug") REFERENCES "public"."matches"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_match_events_slug_ts" ON "match_events" USING btree ("match_slug","timestamp_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_match_players_slug_entity" ON "match_players" USING btree ("match_slug","replay_entity_id");--> statement-breakpoint
CREATE INDEX "idx_match_players_bhid" ON "match_players" USING btree ("brawlhalla_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_matches_dedupe_hash" ON "matches" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "idx_matches_uploaded_at" ON "matches" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "idx_matches_parse_status" ON "matches" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "idx_matches_pending_format_version" ON "matches" USING btree ("format_version");