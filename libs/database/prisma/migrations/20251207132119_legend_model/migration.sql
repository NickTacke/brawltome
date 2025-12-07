-- CreateTable
CREATE TABLE "Legend" (
    "legendId" INTEGER NOT NULL,
    "legendNameKey" TEXT NOT NULL,
    "bioName" TEXT NOT NULL,
    "bioAka" TEXT,
    "bioQuote" TEXT,
    "bioQuoteAboutAttrib" TEXT NOT NULL,
    "bioQuoteFrom" TEXT,
    "bioQuoteFromAttrib" TEXT,
    "bioText" TEXT,
    "botName" TEXT,
    "weaponOne" TEXT NOT NULL,
    "weaponTwo" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "dexterity" TEXT NOT NULL,
    "defense" TEXT NOT NULL,
    "speed" TEXT NOT NULL,

    CONSTRAINT "Legend_pkey" PRIMARY KEY ("legendId")
);
