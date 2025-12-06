/*
  Warnings:

  - The `bestLegend` column on the `Player` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Player" DROP COLUMN "bestLegend",
ADD COLUMN     "bestLegend" INTEGER DEFAULT 0;
