-- CreateTable
CREATE TABLE "Player" (
    "rank" INTEGER DEFAULT 0,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "brawlhallaId" INTEGER NOT NULL,
    "bestLegend" TEXT,
    "bestLegendGames" INTEGER DEFAULT 0,
    "bestLegendWins" INTEGER DEFAULT 0,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "region" TEXT,
    "peakRating" INTEGER DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("brawlhallaId")
);

-- CreateIndex
CREATE INDEX "Player_name_idx" ON "Player"("name");

-- CreateIndex
CREATE INDEX "Player_aliases_idx" ON "Player"("aliases");
