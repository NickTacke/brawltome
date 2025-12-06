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
                stats: {
                    include: {
                        legends: true,
                        clan: true,
                    },
                },
                ranked: {
                    include: {
                        legends: true,
                        teams: true,
                    },
                },
            },
        });
        if (!player) return null;
        
        void this.incrementViewCount(id); // Fire and forget

        const now = Date.now();
        const rankedAge = player.ranked ? now - player.ranked.lastUpdated.getTime() : Infinity;
        const statsAge = player.stats ? now - player.stats.lastUpdated.getTime() : Infinity;

        // Queue jobs if necessary
        if (rankedAge > RANKED_TTL) {
            try {
                const priority = this.calculatePriority(player.viewCount, rankedAge, 'ranked');
                await this.addJob('refresh-ranked', { id }, priority);
            } catch (error) {
                this.logger.error(`Error queuing ranked refresh for ${id}`, error);
            }
        }
        if (statsAge > STATS_TTL) {
            try {
                const priority = this.calculatePriority(player.viewCount, statsAge, 'stats');
                await this.addJob('refresh-stats', { id }, priority);
            } catch (error) {
                this.logger.error(`Error queuing stats refresh for ${id}`, error);
            }
        }

        return {
            ...player,
            isRefreshing: rankedAge > RANKED_TTL || statsAge > STATS_TTL
        };
    }

    private async addJob(name: string, data: { id: number }, priority: number) {
        const jobId = `${name}-${data.id}`;
        const job = await this.refreshQueue.getJob(jobId);

        if (job) {
            const state = await job.getState();
            if (state === 'failed') {
                await job.remove();
                this.logger.warn(`Removed failed job ${jobId} to re-queue`);
            } else {
                return;
            }
        }

        await this.refreshQueue.add(name, data, {
            jobId,
            priority,
            removeOnComplete: true,
            removeOnFail: true, // Auto-remove on fail to prevent "stuck" jobs if our manual check misses something
        });
        this.logger.debug(`Queued ${name} for ${data.id} with priority ${priority}`);
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