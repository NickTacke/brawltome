/*
  Warnings:

  - The primary key for the `PlayerRankedTeam` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `brawlhallaId` on the `PlayerRankedTeam` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `PlayerRankedTeam` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "PlayerRankedTeam" DROP CONSTRAINT "PlayerRankedTeam_brawlhallaId_fkey";

-- AlterTable
ALTER TABLE "PlayerRankedTeam" DROP CONSTRAINT "PlayerRankedTeam_pkey",
DROP COLUMN "brawlhallaId",
DROP COLUMN "id",
ADD CONSTRAINT "PlayerRankedTeam_pkey" PRIMARY KEY ("brawlhallaIdOne", "brawlhallaIdTwo");

-- AddForeignKey
ALTER TABLE "PlayerRankedTeam" ADD CONSTRAINT "PlayerRankedTeam_brawlhallaIdOne_fkey" FOREIGN KEY ("brawlhallaIdOne") REFERENCES "PlayerRanked"("brawlhallaId") ON DELETE RESTRICT ON UPDATE CASCADE;
