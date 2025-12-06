/*
  Warnings:

  - You are about to drop the column `aliases` on the `Player` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Player_aliases_idx";

-- AlterTable
ALTER TABLE "Player" DROP COLUMN "aliases",
ADD COLUMN     "aliasesKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aliasesValues" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Player_aliasesKeys_idx" ON "Player"("aliasesKeys");
