import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Service for resolving the best legend for clan members.
 * Uses ranked data first, falling back to stats XP if no ranked data exists.
 */
@Injectable()
export class ClanLegendResolverService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resolves the best legend name key for each member ID.
   * Priority: ranked rating > stats XP
   *
   * @param memberIds - Array of brawlhalla IDs to resolve legends for
   * @returns Map of brawlhallaId to legendNameKey
   */
  async resolveBestLegends(memberIds: number[]): Promise<Map<number, string>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    // Get best ranked legends by rating
    const bestRankedLegends = await this.prisma.playerRankedLegend.findMany({
      where: { brawlhallaId: { in: memberIds } },
      orderBy: { rating: 'desc' },
      distinct: ['brawlhallaId'],
      select: { brawlhallaId: true, legendId: true },
    });

    // Get legend name keys for the ranked legends
    const legendIds = bestRankedLegends.map((bl) => bl.legendId);
    const legends = await this.prisma.legend.findMany({
      where: { legendId: { in: legendIds } },
      select: { legendId: true, legendNameKey: true },
    });

    const legendKeyMap = new Map(
      legends.map((l) => [l.legendId, l.legendNameKey])
    );

    // Build the result map from ranked data
    const playerLegendMap = new Map<number, string>();
    for (const bl of bestRankedLegends) {
      const legendNameKey = legendKeyMap.get(bl.legendId);
      if (legendNameKey) {
        playerLegendMap.set(bl.brawlhallaId, legendNameKey);
      }
    }

    // Fallback to stats XP for members without ranked data
    const missingRankedIds = memberIds.filter(
      (pid) => !playerLegendMap.has(pid)
    );

    if (missingRankedIds.length > 0) {
      const statsFallback = await this.prisma.playerStatsLegend.findMany({
        where: { brawlhallaId: { in: missingRankedIds } },
        orderBy: { xp: 'desc' },
        distinct: ['brawlhallaId'],
        select: { brawlhallaId: true, legendNameKey: true },
      });

      for (const row of statsFallback) {
        if (row.legendNameKey) {
          playerLegendMap.set(row.brawlhallaId, row.legendNameKey);
        }
      }
    }

    return playerLegendMap;
  }
}
