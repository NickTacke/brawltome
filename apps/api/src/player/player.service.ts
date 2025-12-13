import { Injectable, Logger, OnModuleInit, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PlayerRankedLegendDTO, PlayerRankedTeamDTO } from '@brawltome/shared-types';
import { createWeaponAggregator, parseDamage } from '@brawltome/shared-utils';

// Thresholds
const RANKED_TTL = 1000 * 60 * 60; // 1 hour
const STATS_TTL = 12 * 1000 * 60 * 60; // 12 hours

@Injectable()
export class PlayerService implements OnModuleInit {
    private readonly logger = new Logger(PlayerService.name);
    private legendCache: Map<number, string> = new Map();
    private legendKeyCache: Map<string, string> = new Map();
    private legendIdToKeyCache: Map<number, string> = new Map();
    private legendIdToWeaponsCache: Map<number, { weaponOne: string; weaponTwo: string }> = new Map();

    constructor(
        private prisma: PrismaService,
        @InjectQueue('refresh-queue') private refreshQueue: Queue,
        private bhApiClient: BhApiClientService,
    ) {}

    async onModuleInit() {
        await this.refreshLegendCache();
    }

    async refreshLegendCache() {
        try {
            const legends = await this.prisma.legend.findMany({
                select: { legendId: true, legendNameKey: true, bioName: true, weaponOne: true, weaponTwo: true }
            });
            this.legendCache = new Map(legends.map(l => [l.legendId, l.bioName]));
            this.legendKeyCache = new Map(legends.map(l => [l.legendNameKey, l.bioName]));
            this.legendIdToKeyCache = new Map(legends.map(l => [l.legendId, l.legendNameKey]));
            this.legendIdToWeaponsCache = new Map(legends.map(l => [l.legendId, { weaponOne: l.weaponOne, weaponTwo: l.weaponTwo }]));
            this.logger.log(`Loaded ${this.legendCache.size} legends into cache 🛡️`);
        } catch (error) {
            this.logger.error('Failed to load legend cache', error);
        }
    }

    async getPlayer(id: number) {
        // Fetch Player from database
        let player = await this.prisma.player.findUnique({
            where: { brawlhallaId: id },
            include: {
                aliases: {
                    select: {
                        key: true,
                        value: true,
                    },
                },
                stats: {
                    include: {
                        legends: true,
                        clan: true,
                        weaponStats: true,
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

        // If not found, try to discover from API
        if (!player) {
            player = await this.discoverPlayer(id);
            if (!player) return null;
        }
        
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

        // Enrich legends with bioName
        if (player.stats?.legends) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (player.stats.legends as any[]) = player.stats.legends.map(l => ({
                ...l,
                bioName: this.legendKeyCache.get(l.legendNameKey) || l.legendNameKey,
                weaponOne: this.legendIdToWeaponsCache.get(l.legendId)?.weaponOne,
                weaponTwo: this.legendIdToWeaponsCache.get(l.legendId)?.weaponTwo,
            }));
        }

        if (player.ranked?.legends) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (player.ranked.legends as any[]) = player.ranked.legends.map(l => ({
                ...l,
                bioName: this.legendKeyCache.get(l.legendNameKey) || l.legendNameKey,
                weaponOne: this.legendIdToWeaponsCache.get(l.legendId)?.weaponOne,
                weaponTwo: this.legendIdToWeaponsCache.get(l.legendId)?.weaponTwo,
            }));
        }

        // Join stats legends with ranked legends (convenience view for frontend)
        if (player.stats?.legends) {
            const rankedByLegendId = new Map<number, {
                rating: number;
                peakRating: number;
                tier: string;
                wins: number;
                games: number;
            }>();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const rl of ((player.ranked?.legends || []) as any[])) {
                rankedByLegendId.set(rl.legendId, {
                    rating: rl.rating,
                    peakRating: rl.peakRating,
                    tier: rl.tier,
                    wins: rl.wins,
                    games: rl.games,
                });
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (player.stats as any).legendsEnriched = (player.stats.legends as any[]).map((sl) => ({
                ...sl,
                ranked: rankedByLegendId.get(sl.legendId) || null,
            }));
        }

        // Derived stats (persisted with fallback computation)
        if (player.stats) {
            const legends = (player.stats.legends || []) as Array<{
                legendId: number;
                matchTime: number;
                timeHeldWeaponOne: number;
                timeHeldWeaponTwo: number;
                damageWeaponOne: string;
                damageWeaponTwo: string;
                KOWeaponOne: number;
                KOWeaponTwo: number;
            }>;

            const playtimeSeconds =
                (player.stats.matchTimeTotal ?? 0) > 0
                    ? player.stats.matchTimeTotal
                    : legends.reduce((sum, l) => sum + (l.matchTime || 0), 0);
            const weaponAgg = createWeaponAggregator();

            // Prefer persisted rows, but if missing/stale, compute from legend breakdown using cached weapon mapping
            if (player.stats.weaponStats && player.stats.weaponStats.length > 0) {
                for (const w of player.stats.weaponStats as Array<{ weapon: string; timeHeld: number; damage: string; KOs: number }>) {
                    weaponAgg.add(w.weapon, w.timeHeld, parseDamage(w.damage), w.KOs);
                }
            } else {
                for (const l of legends) {
                    const weapons = this.legendIdToWeaponsCache.get(l.legendId);
                    if (!weapons) continue;
                    weaponAgg.add(weapons.weaponOne, l.timeHeldWeaponOne || 0, parseDamage(l.damageWeaponOne), l.KOWeaponOne || 0);
                    weaponAgg.add(weapons.weaponTwo, l.timeHeldWeaponTwo || 0, parseDamage(l.damageWeaponTwo), l.KOWeaponTwo || 0);
                }
            }

            const weaponStats = Array.from(weaponAgg.values())
                .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
                .sort((a, b) => b.timeHeld - a.timeHeld);

            const totalTimeHeld = weaponStats.reduce((sum, w) => sum + w.timeHeld, 0);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (player.stats as any).playtimeSeconds = playtimeSeconds;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (player.stats as any).weaponStats = weaponStats.map((w) => ({
                weapon: w.weapon,
                timeHeld: w.timeHeld,
                damage: String(w.damage),
                KOs: w.KOs,
                share: totalTimeHeld > 0 ? w.timeHeld / totalTimeHeld : 0,
            }));
        }

        return {
            ...player,
            isRefreshing: rankedAge > RANKED_TTL || statsAge > STATS_TTL
        };
    }

    private async discoverPlayer(id: number) {
        // Check tokens first
        const tokens = await this.bhApiClient.getRemainingTokens();
        if (tokens < 50) {
            this.logger.warn(`Discovery blocked for ${id} due to low tokens (${tokens})`);
            throw new HttpException('Server busy. Cannot fetch new player data right now.', HttpStatus.TOO_MANY_REQUESTS);
        }

        this.logger.log(`Discovering player ${id} from API...`);

        try {
            // Priority: Stats first (for name/existence), then Ranked
            let name = '';
            let region = 'UNKNOWN';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let rankedData: any = {};
            
            try {
                const statsData = await this.bhApiClient.getPlayerStats(id);
                name = statsData.name || '';
            } catch (e) {
                 // Stats might fail for various reasons (404 etc), but it's our primary source for "existence"
                 this.logger.warn(`Failed to fetch stats for ${id}: ${e}`);
            }

            // If we didn't find a name in stats, we can't create the player reliably
            if (!name) {
                this.logger.warn(`Could not find name for player ${id} in stats.`);
                return null;
            }

            // Try fetching ranked data to enrich
            try {
                rankedData = await this.bhApiClient.getPlayerRanked(id);
                region = rankedData.region || 'UNKNOWN';
            } catch (e) {
                this.logger.warn(`Failed to fetch ranked data for ${id}, using default values. ${e}`);
            }

            // Save to DB
            await this.prisma.$transaction(async (tx) => {
                 await tx.player.upsert({
                    where: { brawlhallaId: id },
                    create: {
                        brawlhallaId: id,
                        name: name,
                        region: region,
                        rating: rankedData.rating || 0,
                        peakRating: rankedData.peak_rating || 0,
                        tier: rankedData.tier || 'Unranked',
                        games: rankedData.games || 0,
                        wins: rankedData.wins || 0,
                    },
                    update: {
                        name: name,
                        rating: rankedData.rating || 0,
                        peakRating: rankedData.peak_rating || 0,
                        tier: rankedData.tier || 'Unranked',
                        games: rankedData.games || 0,
                        wins: rankedData.wins || 0,
                    },
                });

                if (rankedData && rankedData.legends) {
                    await tx.playerRanked.upsert({
                        where: { brawlhallaId: id },
                        update: {
                            globalRank: rankedData.global_rank || 0,
                            regionRank: rankedData.region_rank || 0,
                            lastUpdated: new Date(),
                            legends: {
                                deleteMany: {},
                                create: this.mapLegends(rankedData.legends),
                            },
                            teams: {
                                deleteMany: {},
                                create: this.mapTeams(rankedData['2v2']),
                            },
                        },
                        create: {
                            brawlhallaId: id,
                            globalRank: rankedData.global_rank || 0,
                            regionRank: rankedData.region_rank || 0,
                            lastUpdated: new Date(),
                            legends: {
                                create: this.mapLegends(rankedData.legends),
                            },
                            teams: {
                                create: this.mapTeams(rankedData['2v2']),
                            },
                        },
                    });
                }
            });

             // Queue full refreshes to ensure we have consistent data
             await this.refreshQueue.add('refresh-stats', { id });
             if (rankedData.legends) {
                  await this.refreshQueue.add('refresh-ranked', { id });
             }

            // Return the newly created player
            return this.prisma.player.findUnique({
                where: { brawlhallaId: id },
                include: {
                    aliases: {
                        select: {
                            key: true,
                            value: true,
                        },
                    },
                    stats: {
                        include: {
                            legends: true,
                            clan: true,
                            weaponStats: true,
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

        } catch (error) {
            this.logger.warn(`Failed to discover player ${id}: ${error}`);
            return null;
        }
    }

    async getLeaderboard(page: number, region?: string, sort: 'rating' | 'wins' | 'games' | 'peakRating' = 'rating', limit?: number) {
        const MAX_RANKINGS_PAGES = 200; // How many BHAPI pages the janitor keeps fresh
        const RANKINGS_PAGE_SIZE = 50; // BHAPI rankings page size
        const MAX_RANKINGS_ENTRIES = MAX_RANKINGS_PAGES * RANKINGS_PAGE_SIZE;

        const safeTake = Math.min(Math.max(limit ?? 20, 1), 100);
        const requestedPage = Math.max(page || 1, 1);

        const where = region && region !== 'all' ? { region } : {};

        const orderBy = { [sort]: 'desc' };

        const maxPagesForTake = Math.max(1, Math.ceil(MAX_RANKINGS_ENTRIES / safeTake));
        const prelimPage = Math.min(requestedPage, maxPagesForTake);

        const total = await this.prisma.player.count({ where });
        const cappedTotal = Math.min(total, MAX_RANKINGS_ENTRIES);
        const totalPages = Math.max(1, Math.min(Math.ceil(cappedTotal / safeTake), maxPagesForTake));
        const safePage = Math.min(prelimPage, totalPages);
        const skip = (safePage - 1) * safeTake;

        const players = await this.prisma.player.findMany({
            where,
            orderBy,
            take: safeTake,
            skip,
            select: {
                brawlhallaId: true,
                name: true,
                region: true,
                rating: true,
                peakRating: true,
                tier: true,
                wins: true,
                games: true,
                bestLegend: true,
            }
        });

        // Enrich with Legend Names from Cache
        const enrichedPlayers = players.map(p => ({
            ...p,
            bestLegendName: p.bestLegend ? this.legendCache.get(p.bestLegend) : null,
            bestLegendNameKey: p.bestLegend ? this.legendIdToKeyCache.get(p.bestLegend) : null
        }));

        return {
            data: enrichedPlayers,
            meta: {
                page: safePage,
                total: cappedTotal,
                totalPages
            }
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

        try {
            await this.refreshQueue.add(name, data, {
                jobId,
                priority,
                removeOnComplete: true,
                removeOnFail: true, // Auto-remove on fail to prevent "stuck" jobs if our manual check misses something
            });
            this.logger.debug(`Queued ${name} for ${data.id} with priority ${priority}`);
        } 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        catch (error: any) {
            if (!error.message?.includes('already exists')) {
                this.logger.error(`Error queuing ${name} for ${data.id}`, error);
            }
        }
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

    // Helper methods for mapping
    private mapLegends(legends: PlayerRankedLegendDTO[]) {
        if (!legends) return [];
        return legends.map((legend) => ({
            legendId: legend.legend_id,
            legendNameKey: legend.legend_name_key,
            rating: legend.rating,
            peakRating: legend.peak_rating,
            tier: legend.tier,
            wins: legend.wins,
            games: legend.games,
        }));
    }

    private mapTeams(teams: PlayerRankedTeamDTO[]) {
        if (!teams) return [];
        
        // Deduplicate teams based on ID pairs
        const uniqueTeams = new Map<string, PlayerRankedTeamDTO>();
        for (const team of teams) {
            const key = `${team.brawlhalla_id_one}-${team.brawlhalla_id_two}`;
            if (!uniqueTeams.has(key)) {
                uniqueTeams.set(key, team);
            }
        }

        return Array.from(uniqueTeams.values()).map((team) => {
            return {
                brawlhallaIdOne: team.brawlhalla_id_one,
                brawlhallaIdTwo: team.brawlhalla_id_two,
                teamName: team.teamname,
                rating: team.rating,
                peakRating: team.peak_rating,
                tier: team.tier,
                wins: team.wins,
                games: team.games,
            };
        });
    }
}
