/*
  Warnings:

  - A unique constraint covering the columns `[legendNameKey]` on the table `Legend` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "ClanMember" (
    "clanId" INTEGER NOT NULL,
    "brawlhallaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "joinDate" TIMESTAMP(3) NOT NULL,
    "xp" INTEGER NOT NULL,

    CONSTRAINT "ClanMember_pkey" PRIMARY KEY ("clanId","brawlhallaId")
);

-- CreateTable
CREATE TABLE "Clan" (
    "clanId" INTEGER NOT NULL,
    "clanName" TEXT NOT NULL,
    "clanCreateDate" TIMESTAMP(3) NOT NULL,
    "clanXp" TEXT NOT NULL,
    "clanLifetimeXp" INTEGER NOT NULL,

    CONSTRAINT "Clan_pkey" PRIMARY KEY ("clanId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Legend_legendNameKey_key" ON "Legend"("legendNameKey");

-- AddForeignKey
ALTER TABLE "ClanMember" ADD CONSTRAINT "ClanMember_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan"("clanId") ON DELETE CASCADE ON UPDATE CASCADE;
