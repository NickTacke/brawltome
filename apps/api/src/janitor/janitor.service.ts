import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const IDLE_TOKEN_THRESHOLD = 140; // Only run if we have plenty of tokens
const VIP_VIEW_THRESHOLD = 10; // Players with more views than this are VIPs - TODO: Dynamic threshold based on average view count
const VIP_STALE_HOURS = 24; // Refresh VIPs if data is older than this

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
        await this.refreshStaleVIPs();
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

    private async refreshStaleVIPs() {
        // Find players with high view counts who haven't been updated recently
        const staleDate = new Date(Date.now() - VIP_STALE_HOURS * 60 * 60 * 1000);
        
        const staleVIPs = await this.prisma.player.findMany({
            where: {
                viewCount: { gte: VIP_VIEW_THRESHOLD },
                stats: {
                    lastUpdated: { lt: staleDate }
                }
            },
            take: 5, // Process a few at a time
            orderBy: { viewCount: 'desc' },
            select: { brawlhallaId: true, name: true }
        });

        if (staleVIPs.length > 0) {
            this.logger.log(`Found ${staleVIPs.length} stale VIPs. Queuing refresh...`);
            for (const vip of staleVIPs) {
                // Queue a stats refresh with low priority
                await this.refreshQueue.add('refresh-stats', { id: vip.brawlhallaId }, {
                    priority: 100, // Lowest priority
                    jobId: `janitor-stats-${vip.brawlhallaId}-${Date.now()}`,
                    removeOnComplete: true,
                    removeOnFail: true
                });
            }
        }
    }
}
