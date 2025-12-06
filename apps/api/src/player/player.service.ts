import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@brawltome/database';

// Thresholds
const RANKED_TTL = 1000 * 60 * 15; // 15 minutes
const STATS_TTL = 6 * 1000 * 60 * 60; // 6 hours

@Injectable()
export class PlayerService {
    private readonly logger = new Logger(PlayerService.name);

    constructor(
        private prisma: PrismaService,
        @InjectQueue('refresh-queue') private refreshQueue: Queue
    ) {}

    async getPlayer(id: number) {
        // Fetch Player from database
        const player = await this.prisma.player.findUnique({
            where: { brawlhallaId: id },
            include: {
                stats: true,
                ranked: true,
            },
        });
        if (!player) return null;
        
        await this.incrementViewCount(id); // Fire and forget

        const now = Date.now();
        const rankedAge = player.ranked ? now - player.ranked.lastUpdated.getTime() : Infinity;
        const statsAge = player.stats ? now - player.stats.lastUpdated.getTime() : Infinity;

        // Queue jobs if necessary
        if (rankedAge > RANKED_TTL) {
            const priority = this.calculatePriority(player.viewCount, rankedAge, 'ranked');
            await this.refreshQueue.add('refresh-ranked', { id }, {
                jobId: `refresh-ranked-${id}`,
                priority: priority,
                removeOnComplete: true
            });
            this.logger.debug(`Queued ranked refresh for ${id} with priority ${priority}`);
        }
        if (statsAge > STATS_TTL) {
            const priority = this.calculatePriority(player.viewCount, statsAge, 'stats');
            await this.refreshQueue.add('refresh-stats', { id }, {
                jobId: `refresh-stats-${id}`,
                priority: priority,
                removeOnComplete: true
            });
            this.logger.debug(`Queued stats refresh for ${id} with priority ${priority}`);
        }

        return {
            ...player,
            isRefreshing: rankedAge > RANKED_TTL || statsAge > STATS_TTL
        };
    }

    private async incrementViewCount(id: number) {
        try {
            await this.prisma.player.update({
                where: { brawlhallaId: id },
                data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
            });
        } 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        catch (error) {
            /* I don't really care about analytics errors to be honest */
        }
    }

    // Priority helper - Lower is better
    private calculatePriority(viewCount: number, ageMs: number, type: 'ranked' | 'stats'): number {
        let priority = Math.max(1, 100 - Math.floor(Math.sqrt(viewCount))); // Base priority based on view count
        if (ageMs > 1000 * 60 * 60 * 24) priority -= 20; // If data is really old, boost priority
        if (type === 'stats') priority += 10; // Stats are less important than ranked
        return Math.max(1, Math.min(100, priority));
    }
}