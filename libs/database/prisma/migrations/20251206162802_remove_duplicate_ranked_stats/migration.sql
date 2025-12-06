/*
  Warnings:

  - You are about to drop the column `games` on the `PlayerRanked` table. All the data in the column will be lost.
  - You are about to drop the column `peakRating` on the `PlayerRanked` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `PlayerRanked` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `PlayerRanked` table. All the data in the column will be lost.
  - You are about to drop the column `tier` on the `PlayerRanked` table. All the data in the column will be lost.
  - You are about to drop the column `wins` on the `PlayerRanked` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PlayerRanked" DROP COLUMN "games",
DROP COLUMN "peakRating",
DROP COLUMN "rating",
DROP COLUMN "region",
DROP COLUMN "tier",
DROP COLUMN "wins";
