import { NestFactory } from '@nestjs/core';
import { SeederModule } from './seeder.module';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { Logger } from '@nestjs/common';
import { RankingBracket, Region, REGIONS } from '@brawltome/shared-types';

async function bootstrap() {
  const logger = new Logger('Seeder');
  const app = await NestFactory.createApplicationContext(SeederModule);

  const bhApiClient = app.get(BhApiClientService);
  const prisma = app.get(PrismaService);

  const BRACKET: RankingBracket = '1v1';
  const START_PAGE = parseInt(process.env.SEED_START_PAGE || '1', 10);
  const MAX_PAGES = parseInt(process.env.SEED_MAX_PAGES || '1000', 10);

  logger.log(
    `Starting seeding pages ${START_PAGE}..${MAX_PAGES} for regions: ${REGIONS.join(
      ', '
    )}`
  );

  for (const region of REGIONS) {
    logger.log(`Seeding region: ${region}`);
    for (let page = START_PAGE; page <= MAX_PAGES; page++) {
      try {
        const remainingTokens = await bhApiClient.getRemainingTokens();
        if (remainingTokens < 10) {
          logger.log(`Not enough tokens to fetch rankings; waiting 60s`);
          // Keep waiting until we have more tokens
          page--;
          await new Promise((r) => setTimeout(r, 1 * 60 * 1000));
          continue;
        }

        // Fetch global rankings
        const players = await bhApiClient.getRankings<typeof BRACKET>(
          BRACKET,
          region,
          page
        );

        if (!players || players.length === 0) {
          logger.log(
            `No players found in ${region} page ${page}; moving to next region`
          );
          break;
        }

        // Bulk upsert
        const brawlhallaIds = players.map((p) => p.brawlhalla_id);
        const existingPlayers = await prisma.player.findMany({
          where: { brawlhallaId: { in: brawlhallaIds } },
          select: { brawlhallaId: true, name: true },
        });
        const existingMap = new Map(
          existingPlayers.map((p) => [p.brawlhallaId, p])
        );

        const operations = players.map((p) => {
          const existing = existingMap.get(p.brawlhalla_id);

          const aliasUpdate =
            existing && existing.name !== p.name
              ? {
                  aliases: {
                    upsert: {
                      where: {
                        brawlhallaId_key: {
                          brawlhallaId: existing.brawlhallaId,
                          key: existing.name.toLowerCase(),
                        },
                      },
                      create: {
                        key: existing.name.toLowerCase(),
                        value: existing.name,
                      },
                      update: {},
                    },
                  },
                }
              : {};

          return prisma.player.upsert({
            where: { brawlhallaId: p.brawlhalla_id },
            update: {
              name: p.name,
              region: p.region,
              ...aliasUpdate,
              rating: p.rating,
              peakRating: p.peak_rating,
              tier: p.tier,
              games: p.games,
              wins: p.wins,
              bestLegend: p.best_legend,
              bestLegendGames: p.best_legend_games,
              bestLegendWins: p.best_legend_wins,
              lastUpdated: new Date(),
            },
            create: {
              brawlhallaId: p.brawlhalla_id,
              name: p.name,
              region: p.region,
              rating: p.rating,
              peakRating: p.peak_rating,
              tier: p.tier,
              games: p.games,
              wins: p.wins,
              bestLegend: p.best_legend,
              bestLegendGames: p.best_legend_games,
              bestLegendWins: p.best_legend_wins,
              lastUpdated: new Date(),
            },
          });
        });

        await prisma.$transaction(operations);

        logger.log(
          `Indexed ${region} page ${page} (rank ${1 + (page - 1) * 50}-${
            page * 50
          })`
        );
      } catch (error) {
        logger.error(
          `Error fetching rankings for ${region} page ${page}`,
          error
        );
        await new Promise((r) => setTimeout(r, 2000));
        page--; // Retry the same page
        continue;
      }
    }
  }

  logger.log('Seeding complete');
  await app.close();
}

bootstrap();
