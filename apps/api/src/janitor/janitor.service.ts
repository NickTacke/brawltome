import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const IDLE_TOKEN_THRESHOLD = 100; // Only run if we have plenty of tokens

@Injectable()
export class JanitorService {
    private readonly logger = new Logger(JanitorService.name);
    private currentPage = 1;

    constructor(
        private bhApiClient: BhApiClientService,
        private prisma: PrismaService,
        @InjectQueue('refresh-queue') private refreshQueue: Queue,
    ) {}

    @Cron(CronExpression.EVERY_MINUTE)
    async performMaintenance() {
        const tokens = await this.bhApiClient.getRemainingTokens();
        
        // Only work if the API is "idle"
        if (tokens < IDLE_TOKEN_THRESHOLD) {
            this.logger.debug(`Janitor sleeping. Tokens: ${tokens} < ${IDLE_TOKEN_THRESHOLD}`);
            return;
        }

        this.logger.log(`🧹 Janitor waking up! Tokens: ${tokens}`);

        await this.refreshRankingsPage();
        await this.queueMissingDataRefreshes();
        // TODO: After missing data is filled, start refreshing clans
    }

    private async refreshRankingsPage() {
        try {
            this.logger.log(`Refreshing rankings page ${this.currentPage}...`);
            const rankings = await this.bhApiClient.getRankings('1v1', 'all', this.currentPage);
            
            if (rankings.length > 0) {
                for (const p of rankings) {
                    // Skip if name is missing / shouldn't really happen
                    if (!p.name) continue;

                    const existing = await this.prisma.player.findUnique({
                        where: { brawlhallaId: p.brawlhalla_id },
                        select: { name: true, brawlhallaId: true }
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

                    await this.prisma.player.upsert({
                        where: { brawlhallaId: p.brawlhalla_id },
                        create: {
                            brawlhallaId: p.brawlhalla_id,
                            name: p.name,
                            region: p.region,
                            rating: p.rating,
                            peakRating: p.peak_rating,
                            tier: p.tier,
                            games: p.games,
                            wins: p.wins,
                        },
                        update: {
                            name: p.name,
                            ...aliasUpdate,
                            rating: p.rating,
                            peakRating: p.peak_rating,
                            tier: p.tier,
                            games: p.games,
                            wins: p.wins,
                        },
                    });
                }
                this.logger.log(`Updated ${rankings.length} players from page ${this.currentPage}`);
            }

            // Cycle pages (1 to 100 covers top 5000 players)
            this.currentPage++;
            if (this.currentPage > 100) {
                this.currentPage = 1;
            }

        } catch (error) {
            this.logger.error(`Failed to refresh rankings page ${this.currentPage}`, error);
        }
    }

    private async queueMissingDataRefreshes() {
        const missingDataPlayers = await this.prisma.player.findMany({
            where: {
                OR: [
                    { stats: null },
                    { ranked: null }
                ]
            },
            orderBy: { rating: 'desc' },
            take: 10,
            include: { stats: { select: { brawlhallaId: true } }, ranked: { select: { brawlhallaId: true } } }
        });

        if (missingDataPlayers.length > 0) {
             this.logger.log(`Found ${missingDataPlayers.length} players with missing data. Queuing...`);
             for (const p of missingDataPlayers) {
                 if (!p.stats) {
                     await this.refreshQueue.add('refresh-stats', { id: p.brawlhallaId }, {
                         priority: 100,
                         jobId: `missing-stats-${p.brawlhallaId}`, // Deduplication
                         removeOnComplete: true,
                         removeOnFail: true
                     }).catch(() => {
                         // Ignore duplicate job errors
                     });
                 }
                 if (!p.ranked) {
                      await this.refreshQueue.add('refresh-ranked', { id: p.brawlhallaId }, {
                         priority: 100,
                         jobId: `missing-ranked-${p.brawlhallaId}`,
                         removeOnComplete: true,
                         removeOnFail: true
                     }).catch(() => {
                         // Ignore duplicate job errors
                     });
                 }
             }
        }
    }
}
