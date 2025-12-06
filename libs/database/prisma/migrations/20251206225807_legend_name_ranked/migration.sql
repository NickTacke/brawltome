/*
  Warnings:

  - Added the required column `legendNameKey` to the `PlayerRankedLegend` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "PlayerClan" DROP CONSTRAINT "PlayerClan_brawlhallaId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerRanked" DROP CONSTRAINT "PlayerRanked_brawlhallaId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerRankedLegend" DROP CONSTRAINT "PlayerRankedLegend_brawlhallaId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerStats" DROP CONSTRAINT "PlayerStats_brawlhallaId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerStatsLegend" DROP CONSTRAINT "PlayerStatsLegend_brawlhallaId_fkey";

-- AlterTable
ALTER TABLE "PlayerRankedLegend" ADD COLUMN     "legendNameKey" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "PlayerStatsLegend" ADD CONSTRAINT "PlayerStatsLegend_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerStats"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerClan" ADD CONSTRAINT "PlayerClan_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerStats"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStats" ADD CONSTRAINT "PlayerStats_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "Player"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRankedLegend" ADD CONSTRAINT "PlayerRankedLegend_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRanked" ADD CONSTRAINT "PlayerRanked_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "Player"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;
