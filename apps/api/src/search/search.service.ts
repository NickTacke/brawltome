import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@brawltome/database';
import { matchesNameOrBasePrefix, sanitizeSearchQuery } from './search.utils';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private legendCache: Map<number, string> = new Map();
  private legendIdToKeyCache: Map<number, string> = new Map();
  private blacklistedIds: Set<number> = new Set();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await Promise.all([
      this.refreshLegendCache(),
      this.refreshBlacklistCache(),
    ]);
  }

  async refreshLegendCache() {
    try {
      const legends = await this.prisma.legend.findMany({
        select: { legendId: true, legendNameKey: true, bioName: true },
      });
      this.legendCache = new Map(legends.map((l) => [l.legendId, l.bioName]));
      this.legendIdToKeyCache = new Map(
        legends.map((l) => [l.legendId, l.legendNameKey])
      );
      this.logger.log(`Loaded ${this.legendCache.size} legends into cache`);
    } catch (error) {
      this.logger.error('Failed to load legend cache', error);
    }
  }

  private async refreshBlacklistCache() {
    try {
      const blacklist = await this.prisma.blacklist.findMany({
        select: { brawlhallaId: true },
      });
      this.blacklistedIds = new Set(blacklist.map((b) => b.brawlhallaId));
      this.logger.log(`Loaded ${this.blacklistedIds.size} blacklisted IDs`);
    } catch (error) {
      this.logger.error('Failed to load blacklist cache', error);
    }
  }

  async searchLocal(query: string) {
    const sanitized = sanitizeSearchQuery(query);

    if (sanitized.length < 2) return { players: [], clans: [] };

    this.logger.debug(`Local search query="${sanitized}"`);

    const blacklistFilter =
      this.blacklistedIds.size > 0
        ? { brawlhallaId: { notIn: Array.from(this.blacklistedIds) } }
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
        take: 50,
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
          matchesNameOrBasePrefix(a.value, sanitized)
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
      .slice(0, 8);

    const enrichedPlayers = filteredPlayers.map((p) => {
      const rankedBestLegendId =
        typeof p.bestLegend === 'number' && p.bestLegend > 0 ? p.bestLegend : 0;
      const statsBestLegend = p.stats?.legends?.[0] ?? null;
      const fallbackLegendId = statsBestLegend?.legendId ?? 0;

      const legendIdForAvatar = rankedBestLegendId || fallbackLegendId || 0;
      const legendNameKeyForAvatar =
        rankedBestLegendId && rankedBestLegendId > 0
          ? this.legendIdToKeyCache.get(rankedBestLegendId) ??
            statsBestLegend?.legendNameKey ??
            null
          : statsBestLegend?.legendNameKey ?? null;
      const legendNameForAvatar =
        legendIdForAvatar && legendIdForAvatar > 0
          ? this.legendCache.get(legendIdForAvatar) ?? null
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
      clans: clans.map((c) => ({
        clanId: c.clanId,
        name: c.clanName,
        xp: c.clanXp,
        memberCount: c._count.members,
      })),
    };
  }
}
