import { Injectable, HttpException, HttpStatus, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '@brawltome/database'
import { BhApiClientService } from '@brawltome/bhapi-client'

@Injectable()
export class SearchService implements OnModuleInit {
    private readonly logger = new Logger(SearchService.name);
    private legendCache: Map<number, string> = new Map();

    constructor(
        private prisma: PrismaService,
        private bhApiClient: BhApiClientService,
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

    // Global Search
    async searchGlobal(query: string) {
        // Check the remaining budget
        const tokens = await this.bhApiClient.getRemainingTokens();
        if (tokens < 10) {
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
            await this.prisma.$transaction(async (tx) => {
                for (const p of results) {
                    // Check if player exists
                    const existing = await tx.player.findUnique({
                        where: { brawlhallaId: p.brawlhalla_id },
                        select: { name: true, brawlhallaId: true },
                    });

                    // If player exists and name changed, add old name to aliases
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

                    await tx.player.upsert({
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
            });
        }
        return results;
    }
}