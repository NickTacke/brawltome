/*
  Warnings:

  - Changed the type of `clanLifetimeXp` on the `PlayerClan` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `personalXp` on the `PlayerClan` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "PlayerClan" DROP COLUMN "clanLifetimeXp",
ADD COLUMN     "clanLifetimeXp" INTEGER NOT NULL,
DROP COLUMN "personalXp",
ADD COLUMN     "personalXp" INTEGER NOT NULL;
