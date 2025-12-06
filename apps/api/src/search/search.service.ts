import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { PrismaService } from '@brawltome/database'
import { BhApiClientService } from '@brawltome/bhapi-client'

@Injectable()
export class SearchService {
    private readonly logger = new Logger(SearchService.name);

    constructor(
        private prisma: PrismaService,
        private bhApiClient: BhApiClientService,
    ) {}

    // Local Search
    async searchLocal(query: string) {
        // Sanitize the query - remove special characters
        const sanitized = query.replace(/[^\w\s-]/gi, '').toLowerCase();

        // Return empty array if query is too short
        if (sanitized.length < 2) return [];


        this.logger.log(`🔍 Local search for "${sanitized}"`);
        return this.prisma.player.findMany({
            where: {
                OR: [
                    {
                        name: {
                            contains: sanitized,
                            mode: 'insensitive',
                        },
                    },
                    {
                        aliasesKeys: {
                            hasSome: [sanitized],
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
                aliasesKeys: true,
                aliasesValues: true,
                rating: true,
                tier: true,
                games: true,
                wins: true,
            },
        });
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
                        select: { name: true, aliasesKeys: true, aliasesValues: true },
                    });

                    // If player exists and name changed, add old name to aliases
                    const updatedAliasesKeys = existing && existing.name !== p.name
                        ? [...new Set([...(existing.aliasesKeys || []), existing.name.toLowerCase()])]
                        : existing?.aliasesKeys || [];
                    
                    const updatedAliasesValues = existing && existing.name !== p.name
                        ? [...new Set([...(existing.aliasesValues || []), existing.name])]
                        : existing?.aliasesValues || [];

                    await tx.player.upsert({
                        where: { brawlhallaId: p.brawlhalla_id },
                        create: {
                            brawlhallaId: p.brawlhalla_id,
                            name: p.name,
                            aliasesKeys: [],
                            aliasesValues: [],
                            rating: p.rating,
                            tier: p.tier,
                            games: p.games,
                            wins: p.wins,
                        },
                        update: {
                            name: p.name,
                            aliasesKeys: updatedAliasesKeys,
                            aliasesValues: updatedAliasesValues,
                            rating: p.rating,
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