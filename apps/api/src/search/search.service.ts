import { Injectable, HttpException, HttpStatus, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '@brawltome/database'
import { BhApiClientService } from '@brawltome/bhapi-client'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { PlayerRankedLegendDTO, PlayerRankedTeamDTO } from '@brawltome/shared-types'

const API_SEARCH_TOKEN_THRESHOLD = 50;

@Injectable()
export class SearchService implements OnModuleInit {
    private readonly logger = new Logger(SearchService.name);
    private legendCache: Map<number, string> = new Map();

    constructor(
        private prisma: PrismaService,
        private bhApiClient: BhApiClientService,
        @InjectQueue('refresh-queue') private refreshQueue: Queue,
    ) {}

    async onModuleInit() {
        await this.refreshLegendCache();
    }

    async refreshLegendCache() {
        try {
            const legends = await this.prisma.legend.findMany({
                select: { legendId: true, bioName: true }
            });
            this.legendCache = new Map(legends.map(l => [l.legendId, l.bioName]));
            this.logger.log(`Loaded ${this.legendCache.size} legends into cache 🛡️`);
        } catch (error) {
            this.logger.error('Failed to load legend cache', error);
        }
    }

    // Local Search
    async searchLocal(query: string) {
        // Check if query is a Brawlhalla ID (numeric)
        if (/^\d+$/.test(query)) {
            return this.searchById(parseInt(query, 10));
        }

        // Sanitize the query - remove special characters
        const sanitized = query.replace(/[^\w\s-]/gi, '');

        // Return empty array if query is too short
        if (sanitized.length < 2) return [];


        this.logger.log(`🔍 Local search for "${sanitized}"`);
        const players = await this.prisma.player.findMany({
            where: {
                OR: [
                    {
                        name: {
                            contains: sanitized,
                            mode: 'insensitive',
                        },
                    },
                    {
                        aliases: {
                            some: {
                                key: {
                                    contains: sanitized,
                                    mode: 'insensitive',
                                },
                            },
                        },
                    },
                ],
            },
            take: 10,
            orderBy: {
                rating: 'desc',
            },
            select: {
                brawlhallaId: true,
                name: true,
                aliases: {
                    select: {
                        key: true,
                        value: true,
                    }
                },
                region: true, // Added
                rating: true,
                tier: true,
                games: true,
                wins: true,
                bestLegend: true, // Added
            },
        });

        // Enrich with Legend Names
        return players.map(p => ({
            ...p,
            bestLegendName: p.bestLegend ? this.legendCache.get(p.bestLegend) : null
        }));
    }

    private async searchById(id: number) {
        this.logger.log(`🔍 Search by ID: ${id}`);
        
        // 1. Try to find in DB
        const player = await this.prisma.player.findUnique({
            where: { brawlhallaId: id },
            select: {
                brawlhallaId: true,
                name: true,
                aliases: {
                    select: {
                        key: true,
                        value: true,
                    }
                },
                region: true,
                rating: true,
                tier: true,
                games: true,
                wins: true,
                bestLegend: true,
            },
        });

        if (player) {
            this.logger.log(`Found player ${id} locally. Queueing refresh.`);
            await this.refreshQueue.add('refresh-ranked', { id });
            await this.refreshQueue.add('refresh-stats', { id });
            
            return [{
                ...player,
                bestLegendName: player.bestLegend ? this.legendCache.get(player.bestLegend) : null
            }];
        }

        // Check the remaining budget before fetching from API
        const tokens = await this.bhApiClient.getRemainingTokens();
        if (tokens < API_SEARCH_TOKEN_THRESHOLD) {
            this.logger.warn(`Search by ID ${id} blocked due to low tokens (${tokens})`);
            throw new HttpException(
                'Server busy. Cannot fetch new player data right now.', 
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        // 2. If not found, fetch from API
        this.logger.log(`Player ${id} not found locally. Fetching from API.`);
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
                return [];
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

            // Queue full refreshes
            await this.refreshQueue.add('refresh-stats', { id });
            if (rankedData.legends) {
                 // We already have ranked data, but queuing it ensures consistency with our refresh logic
                 // or we can skip it since we just upserted it.
                 // Let's queue it to be safe and consistent with background workers
                 await this.refreshQueue.add('refresh-ranked', { id });
            }

            return [{
                brawlhallaId: id,
                name: name,
                region: region,
                rating: rankedData.rating || 0,
                tier: rankedData.tier || 'Unranked',
                games: rankedData.games || 0,
                wins: rankedData.wins || 0,
                bestLegend: null,
                bestLegendName: null,
            }];

        } catch (error) {
            this.logger.warn(`Failed to find player ${id} via API: ${error}`);
            return [];
        }
    }

    // Helper methods
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

    // Global Search
    async searchGlobal(query: string) {
        // Check the remaining budget
        const tokens = await this.bhApiClient.getRemainingTokens();
        if (tokens < API_SEARCH_TOKEN_THRESHOLD) {
            throw new HttpException(
                'Server busy. Global search temporarily disabled.', 
                HttpStatus.TOO_MANY_REQUESTS
            );
        }
        this.logger.log(`🔍 Global search for "${query}"`);

        // Fetch from Brawlhalla API
        const results = await this.bhApiClient.searchPlayer(query);

        // Vacuum - save all results to database (optimal use of rate limit tokens)
        if (results.length > 0) {
            // We use a regular loop instead of transaction loop to allow for individual fallbacks
            for (const p of results) {
                let name = p.name;
                
                // Always try stats if name is missing OR we want to be sure
                // Optimization: In search results, if name is present, it's usually correct.
                // But for robustness if it's empty we fall back.
                
                if (!name || name.length === 0) {
                     this.logger.log(`Name missing in search result for ${p.brawlhalla_id}, trying stats endpoint...`);
                     try {
                        const statsData = await this.bhApiClient.getPlayerStats(p.brawlhalla_id);
                        if (statsData.name && statsData.name.length > 0) {
                            name = statsData.name;
                            this.logger.log(`Found name via stats: ${name}`);
                        }
                     } catch (e) {
                         this.logger.warn(`Failed to fetch stats for name discovery in global search: ${e}`);
                     }
                }

                // If still no name, skip this result from upsert
                if (!name || name.length === 0) {
                     this.logger.warn(`Skipping upsert for player ${p.brawlhalla_id} due to missing name.`);
                     continue;
                }
                
                // Mutate the result object to return the correct name to frontend
                p.name = name;

                try {
                    await this.prisma.$transaction(async (tx) => {
                        // Check if player exists
                        const existing = await tx.player.findUnique({
                            where: { brawlhallaId: p.brawlhalla_id },
                            select: { name: true, brawlhallaId: true },
                        });

                        // If player exists and name changed, add old name to aliases
                        const aliasUpdate = (existing && existing.name !== name) ? {
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

                        await tx.player.upsert({
                            where: { brawlhallaId: p.brawlhalla_id },
                            create: {
                                brawlhallaId: p.brawlhalla_id,
                                name: name,
                                region: p.region,
                                rating: p.rating,
                                peakRating: p.peak_rating,
                                tier: p.tier,
                                games: p.games,
                                wins: p.wins,
                            },
                            update: {
                                name: name,
                                ...aliasUpdate,
                                rating: p.rating,
                                peakRating: p.peak_rating,
                                tier: p.tier,
                                games: p.games,
                                wins: p.wins,
                            },
                        });
                    });

                    // Queue refresh to get full stats eventually
                    await this.refreshQueue.add('refresh-stats', { id: p.brawlhalla_id });

                } catch (err) {
                    this.logger.error(`Failed to upsert player ${p.brawlhalla_id} from global search`, err);
                }
            }
        }
        return results;
    }
}
