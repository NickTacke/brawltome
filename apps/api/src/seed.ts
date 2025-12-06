import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { ConfigService } from '@nestjs/config';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('Seeder');
    const app = await NestFactory.createApplicationContext(AppModule);
    
    const configService = app.get(ConfigService);
    console.log('DEBUG: API KEY present?', !!configService.get('BRAWLHALLA_API_KEY'));

    const bhApiClient = app.get(BhApiClientService);
    const prisma = app.get(PrismaService);

    const REGION = 'all';
    const BRACKET = '1v1';
    const START_PAGE = 1;
    const MAX_PAGES = 1000;

    logger.log(`🚀 Starting seeding from page ${START_PAGE} to ${MAX_PAGES}!`);

    for (let page = START_PAGE; page <= MAX_PAGES; page++) {
        try {
            // Fetch global rankings
            const players = await bhApiClient.getRankings(BRACKET, REGION, page);

            if(!players || players.length === 0) {
                logger.log(`🔍 No players found on page ${page}, stopping!`);
                break;
            }

            // Bulk upsert
            for (const p of players) {
                const existing = await prisma.player.findUnique({
                    where: { brawlhallaId: p.brawlhalla_id },
                    select: { brawlhallaId: true, name: true }
                });

                const aliasUpdate = (existing && existing.name !== p.name) ? {
                    aliases: {
                        upsert: {
                            where: {
                                brawlhallaId_key: {
                                    brawlhallaId: existing.brawlhallaId,
                                    key: existing.name.toLowerCase()
                                }
                            },
                            create: {
                                key: existing.name.toLowerCase(),
                                value: existing.name
                            },
                            update: {}
                        }
                    }
                } : {};

                await prisma.player.upsert({
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
                    }
                });
            }

            logger.log(`✅ Indexed Global Page ${page} (Rank ${1 + (page - 1) * 50} - ${page * 50})`);
        } catch (error) {
            logger.error(`🚨 Error fetching rankings for page ${page}:`, error);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
        }
    }

    logger.log('🏁 Seeding complete!');
    await app.close();
}

bootstrap();