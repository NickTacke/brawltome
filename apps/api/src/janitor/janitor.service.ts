import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const IDLE_TOKEN_THRESHOLD = 100; // Only run if we have plenty of tokens
const MAX_RANKINGS_PAGES = 200;

@Injectable()
export class JanitorService {
    private readonly logger = new Logger(JanitorService.name);
    private current1v1Page = 1;
    private current2v2Page = 1;

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

        await this.refresh1v1RankingsPage();
        await this.refresh2v2RankingsPage();
        await this.queueMissingDataRefreshes();
        // TODO: After missing data is filled, start refreshing clans
    }

    private async refresh1v1RankingsPage() {
        try {
            this.logger.log(`Refreshing 1v1 rankings page ${this.current1v1Page}...`);
            const rankings = await this.bhApiClient.getRankings('1v1', 'all', this.current1v1Page);
            
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
                            lastUpdated: new Date(),
                        },
                        update: {
                            name: p.name,
                            ...aliasUpdate,
                            rating: p.rating,
                            peakRating: p.peak_rating,
                            tier: p.tier,
                            games: p.games,
                            wins: p.wins,
                            lastUpdated: new Date(),
                        },
                    });
                }
                this.logger.log(`Updated ${rankings.length} players from 1v1 page ${this.current1v1Page}`);
            }

            // Cycle pages (1..MAX_RANKINGS_PAGES)
            this.current1v1Page++;
            if (this.current1v1Page > MAX_RANKINGS_PAGES) {
                this.current1v1Page = 1;
            }

        } catch (error) {
            this.logger.error(`Failed to refresh 1v1 rankings page ${this.current1v1Page}`, error);
        }
    }

    private async refresh2v2RankingsPage() {
        try {
            this.logger.log(`Refreshing 2v2 rankings page ${this.current2v2Page}...`);
            const teams = await this.bhApiClient.getRankings('2v2', 'all', this.current2v2Page);

            if (teams.length > 0) {
                for (const t of teams) {
                    const idOne = Math.min(t.brawlhalla_id_one, t.brawlhalla_id_two);
                    const idTwo = Math.max(t.brawlhalla_id_one, t.brawlhalla_id_two);

                    await this.prisma.ranked2v2Team.upsert({
                        where: {
                            region_brawlhallaIdOne_brawlhallaIdTwo: {
                                region: t.region,
                                brawlhallaIdOne: idOne,
                                brawlhallaIdTwo: idTwo,
                            },
                        },
                        create: {
                            region: t.region,
                            brawlhallaIdOne: idOne,
                            brawlhallaIdTwo: idTwo,
                            rank: t.rank,
                            teamName: t.teamname,
                            rating: t.rating,
                            peakRating: t.peak_rating,
                            tier: t.tier,
                            wins: t.wins,
                            games: t.games,
                            lastUpdated: new Date(),
                        },
                        update: {
                            rank: t.rank,
                            teamName: t.teamname,
                            rating: t.rating,
                            peakRating: t.peak_rating,
                            tier: t.tier,
                            wins: t.wins,
                            games: t.games,
                            lastUpdated: new Date(),
                        },
                    });
                }
                this.logger.log(`Updated ${teams.length} teams from 2v2 page ${this.current2v2Page}`);
            }

            this.current2v2Page++;
            if (this.current2v2Page > MAX_RANKINGS_PAGES) {
                this.current2v2Page = 1;
            }

        } catch (error) {
            this.logger.error(`Failed to refresh 2v2 rankings page ${this.current2v2Page}`, error);
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
