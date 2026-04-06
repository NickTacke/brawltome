DROP INDEX "uq_player_link_user";--> statement-breakpoint
ALTER TABLE "player_link" ADD PRIMARY KEY ("user_id");