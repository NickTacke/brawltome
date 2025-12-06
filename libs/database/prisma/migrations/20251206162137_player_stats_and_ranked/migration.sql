-- CreateTable
CREATE TABLE "PlayerStatsLegend" (
    "brawlhallaId" INTEGER NOT NULL,
    "legendId" INTEGER NOT NULL,
    "legendNameKey" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "xpPercentage" DOUBLE PRECISION NOT NULL,
    "games" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "matchTime" INTEGER NOT NULL,
    "KOs" INTEGER NOT NULL,
    "teamKOs" INTEGER NOT NULL,
    "suicides" INTEGER NOT NULL,
    "falls" INTEGER NOT NULL,
    "damageDealt" TEXT NOT NULL,
    "damageTaken" TEXT NOT NULL,
    "damageWeaponOne" TEXT NOT NULL,
    "damageWeaponTwo" TEXT NOT NULL,
    "timeHeldWeaponOne" INTEGER NOT NULL,
    "timeHeldWeaponTwo" INTEGER NOT NULL,
    "KOWeaponOne" INTEGER NOT NULL,
    "KOWeaponTwo" INTEGER NOT NULL,
    "KOUnarmed" INTEGER NOT NULL,
    "KOThrownItem" INTEGER NOT NULL,
    "KOGadgets" INTEGER NOT NULL,
    "damageUnarmed" TEXT NOT NULL,
    "damageThrownItem" TEXT NOT NULL,
    "damageGadgets" TEXT NOT NULL,

    CONSTRAINT "PlayerStatsLegend_pkey" PRIMARY KEY ("brawlhallaId","legendId")
);

-- CreateTable
CREATE TABLE "PlayerClan" (
    "brawlhallaId" INTEGER NOT NULL,
    "clanName" TEXT NOT NULL,
    "clanId" INTEGER NOT NULL,
    "clanXp" TEXT NOT NULL,
    "clanLifetimeXp" TEXT NOT NULL,
    "personalXp" TEXT NOT NULL,

    CONSTRAINT "PlayerClan_pkey" PRIMARY KEY ("brawlhallaId")
);

-- CreateTable
CREATE TABLE "PlayerStats" (
    "brawlhallaId" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "xpPercentage" DOUBLE PRECISION NOT NULL,
    "games" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "damageBomb" TEXT NOT NULL,
    "damageMine" TEXT NOT NULL,
    "damageSpikeball" TEXT NOT NULL,
    "damageSidekick" TEXT NOT NULL,
    "hitSnowball" INTEGER NOT NULL,
    "koBomb" INTEGER NOT NULL,
    "koMine" INTEGER NOT NULL,
    "koSpikeball" INTEGER NOT NULL,
    "koSidekick" INTEGER NOT NULL,
    "koSnowball" INTEGER NOT NULL,

    CONSTRAINT "PlayerStats_pkey" PRIMARY KEY ("brawlhallaId")
);

-- CreateTable
CREATE TABLE "PlayerRankedLegend" (
    "brawlhallaId" INTEGER NOT NULL,
    "legendId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "peakRating" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "games" INTEGER NOT NULL,

    CONSTRAINT "PlayerRankedLegend_pkey" PRIMARY KEY ("brawlhallaId","legendId")
);

-- CreateTable
CREATE TABLE "PlayerRankedTeam" (
    "id" SERIAL NOT NULL,
    "brawlhallaId" INTEGER NOT NULL,
    "brawlhallaIdOne" INTEGER NOT NULL,
    "brawlhallaIdTwo" INTEGER NOT NULL,
    "teamName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "peakRating" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "games" INTEGER NOT NULL,
    "region" TEXT,
    "globalRank" INTEGER,

    CONSTRAINT "PlayerRankedTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerRanked" (
    "brawlhallaId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "peakRating" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "games" INTEGER NOT NULL,
    "region" TEXT,
    "globalRank" INTEGER,
    "regionRank" INTEGER,

    CONSTRAINT "PlayerRanked_pkey" PRIMARY KEY ("brawlhallaId")
);

-- AddForeignKey
ALTER TABLE "PlayerStatsLegend" ADD CONSTRAINT "PlayerStatsLegend_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerStats"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerClan" ADD CONSTRAINT "PlayerClan_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerStats"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStats" ADD CONSTRAINT "PlayerStats_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "Player"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRankedLegend" ADD CONSTRAINT "PlayerRankedLegend_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRankedTeam" ADD CONSTRAINT "PlayerRankedTeam_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRanked" ADD CONSTRAINT "PlayerRanked_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "Player"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;
