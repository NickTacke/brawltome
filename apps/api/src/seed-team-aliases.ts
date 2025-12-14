import { PrismaService } from '@brawltome/database';
import { Logger } from '@nestjs/common';

type TeamCursor = {
  brawlhallaId: number;
  brawlhallaIdOne: number;
  brawlhallaIdTwo: number;
};

type TeamRow = {
  brawlhallaId: number;
  brawlhallaIdOne: number;
  brawlhallaIdTwo: number;
  teamName: string;
};

async function bootstrap() {
  const logger = new Logger('TeamAliasSeeder');
  const prisma = new PrismaService();
  await prisma.$connect();

  const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '2500', 10);
  const DRY_RUN = process.env.DRY_RUN === '1';

  let cursor: TeamCursor | null = null;

  let scannedTeams = 0;
  let parseFailures = 0;
  let candidateAliases = 0;
  let missingPlayers = 0;
  let insertedAliases = 0;

  logger.log(
    `Starting seed-team-aliases (batchSize=${BATCH_SIZE}, dryRun=${DRY_RUN})`
  );

  try {
    // Cursor-based pagination across the composite @@id([brawlhallaId, brawlhallaIdOne, brawlhallaIdTwo])
    // for stable iteration without skip-based pagination.
    while (true) {
      const teams: TeamRow[] = await prisma.playerRankedTeam.findMany({
        take: BATCH_SIZE,
        ...(cursor
          ? {
              skip: 1,
              cursor: {
                brawlhallaId_brawlhallaIdOne_brawlhallaIdTwo: cursor,
              },
            }
          : {}),
        orderBy: [
          { brawlhallaId: 'asc' },
          { brawlhallaIdOne: 'asc' },
          { brawlhallaIdTwo: 'asc' },
        ],
        select: {
          brawlhallaId: true,
          brawlhallaIdOne: true,
          brawlhallaIdTwo: true,
          teamName: true,
        },
      });

      if (teams.length === 0) break;

      scannedTeams += teams.length;

      // Dedup candidates within a batch (and across many teams) by (playerId, aliasKey).
      const candidateMap = new Map<
        string,
        { brawlhallaId: number; key: string; value: string }
      >();

      const involvedIds = new Set<number>();

      for (const t of teams) {
        const parts = t.teamName.split('+');
        if (parts.length !== 2) {
          parseFailures++;
          continue;
        }

        const nameOne = parts[0].trim();
        const nameTwo = parts[1].trim();

        if (nameOne) {
          involvedIds.add(t.brawlhallaIdOne);
          const key = nameOne.toLowerCase();
          candidateMap.set(`${t.brawlhallaIdOne}:${key}`, {
            brawlhallaId: t.brawlhallaIdOne,
            key,
            value: nameOne,
          });
        }

        if (nameTwo) {
          involvedIds.add(t.brawlhallaIdTwo);
          const key = nameTwo.toLowerCase();
          candidateMap.set(`${t.brawlhallaIdTwo}:${key}`, {
            brawlhallaId: t.brawlhallaIdTwo,
            key,
            value: nameTwo,
          });
        }
      }

      candidateAliases += candidateMap.size;

      const ids = Array.from(involvedIds);
      const players = await prisma.player.findMany({
        where: { brawlhallaId: { in: ids } },
        select: {
          brawlhallaId: true,
          name: true,
          aliases: {
            select: { key: true },
          },
        },
      });

      missingPlayers += ids.length - players.length;

      const playerIndex = new Map<
        number,
        { nameLower: string; aliasKeysLower: Set<string> }
      >(
        players.map((p) => [
          p.brawlhallaId,
          {
            nameLower: (p.name || '').toLowerCase(),
            aliasKeysLower: new Set(p.aliases.map((a) => a.key.toLowerCase())),
          },
        ])
      );

      const createData: { brawlhallaId: number; key: string; value: string }[] =
        [];

      for (const c of candidateMap.values()) {
        const p = playerIndex.get(c.brawlhallaId);
        if (!p) continue;

        // Skip if candidate equals current name (case-insensitive)
        if (p.nameLower === c.key) continue;

        // Skip if alias already exists for this player (case-insensitive via key)
        if (p.aliasKeysLower.has(c.key)) continue;

        createData.push(c);
      }

      if (createData.length > 0) {
        if (DRY_RUN) {
          logger.log(
            `DRY_RUN batch: would insert ${createData.length} aliases (candidates=${candidateMap.size}, teams=${teams.length})`
          );
        } else {
          const res = await prisma.playerAlias.createMany({
            data: createData,
            skipDuplicates: true,
          });
          insertedAliases += res.count;
          logger.log(
            `Inserted ${res.count}/${createData.length} aliases (candidates=${candidateMap.size}, teams=${teams.length})`
          );
        }
      } else {
        logger.log(
          `No inserts needed (candidates=${candidateMap.size}, teams=${teams.length})`
        );
      }

      const last = teams[teams.length - 1];
      cursor = {
        brawlhallaId: last.brawlhallaId,
        brawlhallaIdOne: last.brawlhallaIdOne,
        brawlhallaIdTwo: last.brawlhallaIdTwo,
      };
    }

    logger.log(
      `Done. scannedTeams=${scannedTeams} parseFailures=${parseFailures} candidateAliases=${candidateAliases} insertedAliases=${insertedAliases} missingPlayers=${missingPlayers}`
    );
  } catch (error) {
    logger.error('Error during seed-team-aliases', error);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

bootstrap();
