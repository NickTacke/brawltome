-- DropForeignKey
ALTER TABLE "PlayerRankedTeam" DROP CONSTRAINT "PlayerRankedTeam_brawlhallaIdOne_fkey";

-- AlterTable
ALTER TABLE "PlayerRanked" ADD COLUMN     "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PlayerStats" ADD COLUMN     "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "PlayerRankedTeam" ADD CONSTRAINT "PlayerRankedTeam_brawlhallaIdOne_fkey" FOREIGN KEY ("brawlhallaIdOne") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;
