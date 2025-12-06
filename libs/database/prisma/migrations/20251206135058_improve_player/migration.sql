-- AlterTable
ALTER TABLE "Player" ALTER COLUMN "aliases" SET DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Player_rating_idx" ON "Player"("rating" DESC);
