/*
  Warnings:

  - The primary key for the `PlayerRankedTeam` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `brawlhallaId` to the `PlayerRankedTeam` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "PlayerRankedTeam" DROP CONSTRAINT "PlayerRankedTeam_brawlhallaIdOne_fkey";

-- AlterTable
ALTER TABLE "PlayerRankedTeam" DROP CONSTRAINT "PlayerRankedTeam_pkey",
ADD COLUMN     "brawlhallaId" INTEGER NOT NULL,
ADD CONSTRAINT "PlayerRankedTeam_pkey" PRIMARY KEY ("brawlhallaId", "brawlhallaIdOne", "brawlhallaIdTwo");

-- AddForeignKey
ALTER TABLE "PlayerRankedTeam" ADD CONSTRAINT "PlayerRankedTeam_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;
