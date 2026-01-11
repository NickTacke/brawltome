import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, GameDataCacheService } from '@brawltome/database';
import { matchesNameOrBasePrefix, sanitizeSearchQuery } from './search.utils';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private prisma: PrismaService,
    private gameDataCache: GameDataCacheService,
  ) {}

  async searchLocal(query: string) {
    const sanitized = sanitizeSearchQuery(query);

    if (sanitized.length < 2) return { players: [], clans: [] };

    this.logger.debug(`Local search query="${sanitized}"`);

    const blacklistedIds = this.gameDataCache.getBlacklistedIds();
    const blacklistFilter =
      blacklistedIds.size > 0
        ? { brawlhallaId: { notIn: Array.from(blacklistedIds) } }
        : {};

    const [players, clans] = await Promise.all([
      this.prisma.player.findMany({
        where: {
          AND: [
            {
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
            blacklistFilter,
          ],
        },
        take: 100,
        orderBy: [{ rating: 'desc' }, { viewCount: 'desc' }],
        select: {
          brawlhallaId: true,
          name: true,
          aliases: {
            select: {
              key: true,
              value: true,
            },
          },
          region: true,
          rating: true,
          tier: true,
          games: true,
          wins: true,
          bestLegend: true,
          stats: {
            select: {
              legends: {
                orderBy: { xp: 'desc' },
                take: 1,
                select: {
                  legendId: true,
                  legendNameKey: true,
                  xp: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.clan.findMany({
        where: {
          clanName: {
            contains: sanitized,
            mode: 'insensitive',
          },
        },
        take: 5,
        select: {
          clanId: true,
          clanName: true,
          clanXp: true,
          _count: {
            select: { members: true },
          },
        },
      }),
    ]);

    const filteredPlayers = players
      .map((p) => {
        const nameMatch = matchesNameOrBasePrefix(p.name, sanitized);
        if (nameMatch) {
          return { ...p, matchedOn: 'name' as const };
        }

        const matchedAlias = p.aliases?.find((a) =>
          matchesNameOrBasePrefix(a.value, sanitized),
        );
        if (matchedAlias) {
          return {
            ...p,
            matchedOn: 'alias' as const,
            matchedAlias: matchedAlias.value,
          };
        }

        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 40);

    const enrichedPlayers = filteredPlayers.map((p) => {
      const rankedBestLegendId =
        typeof p.bestLegend === 'number' && p.bestLegend > 0 ? p.bestLegend : 0;
      const statsBestLegend = p.stats?.legends?.[0] ?? null;
      const fallbackLegendId = statsBestLegend?.legendId ?? 0;

      const legendIdForAvatar = rankedBestLegendId || fallbackLegendId || 0;
      const legendNameKeyForAvatar =
        rankedBestLegendId && rankedBestLegendId > 0
          ? (this.gameDataCache.getNameKeyById(rankedBestLegendId) ??
            statsBestLegend?.legendNameKey ??
            null)
          : (statsBestLegend?.legendNameKey ?? null);
      const legendNameForAvatar =
        legendIdForAvatar && legendIdForAvatar > 0
          ? (this.gameDataCache.getBioNameById(legendIdForAvatar) ?? null)
          : null;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stats, ...rest } = p;
      return {
        ...rest,
        bestLegendName: legendNameForAvatar,
        bestLegendNameKey: legendNameKeyForAvatar,
      };
    });

    return {
      players: enrichedPlayers,
      clans: clans
        .sort((a, b) => {
          const xpA =
            typeof a.clanXp === 'bigint' ? a.clanXp : BigInt(a.clanXp ?? 0);
          const xpB =
            typeof b.clanXp === 'bigint' ? b.clanXp : BigInt(b.clanXp ?? 0);
          return xpA > xpB ? -1 : xpA < xpB ? 1 : 0;
        })
        .map((c) => ({
          clanId: c.clanId,
          name: c.clanName,
          xp: c.clanXp,
          memberCount: c._count.members,
        })),
    };
  }
}
