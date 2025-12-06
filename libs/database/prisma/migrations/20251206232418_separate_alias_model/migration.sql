/*
  Warnings:

  - You are about to drop the column `aliasesKeys` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `aliasesValues` on the `Player` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Player_aliasesKeys_idx";

-- AlterTable
ALTER TABLE "Player" DROP COLUMN "aliasesKeys",
DROP COLUMN "aliasesValues";

-- CreateTable
CREATE TABLE "PlayerAlias" (
    "brawlhallaId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("brawlhallaId","key")
);

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_brawlhallaId_fkey" FOREIGN KEY ("brawlhallaId") REFERENCES "Player"("brawlhallaId") ON DELETE CASCADE ON UPDATE CASCADE;
