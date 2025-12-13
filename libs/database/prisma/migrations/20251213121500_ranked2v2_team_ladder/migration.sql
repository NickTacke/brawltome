/*
  Ranked2v2Team ladder table for /rankings/2v2 snapshots (DB-backed 2v2 leaderboard)
*/

-- CreateTable
CREATE TABLE "Ranked2v2Team" (
    "region" TEXT NOT NULL,
    "brawlhallaIdOne" INTEGER NOT NULL,
    "brawlhallaIdTwo" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "teamName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "peakRating" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "games" INTEGER NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ranked2v2Team_pkey" PRIMARY KEY ("region","brawlhallaIdOne","brawlhallaIdTwo")
);

-- CreateIndex
CREATE INDEX "Ranked2v2Team_region_rating_idx" ON "Ranked2v2Team"("region", "rating" DESC);

-- CreateIndex
CREATE INDEX "Ranked2v2Team_region_peakRating_idx" ON "Ranked2v2Team"("region", "peakRating" DESC);

-- CreateIndex
CREATE INDEX "Ranked2v2Team_region_wins_idx" ON "Ranked2v2Team"("region", "wins" DESC);

-- CreateIndex
CREATE INDEX "Ranked2v2Team_region_games_idx" ON "Ranked2v2Team"("region", "games" DESC);

-- CreateIndex
CREATE INDEX "Ranked2v2Team_region_rank_idx" ON "Ranked2v2Team"("region", "rank");


