import { Injectable } from '@nestjs/common';
import { PrismaService, GameDataCacheService } from '@brawltome/database';

type LeaderboardSort = 'rating' | 'wins' | 'games' | 'peakRating' | 'rank';

@Injectable()
export class LeaderboardService {
  constructor(
    private prisma: PrismaService,
    private gameDataCache: GameDataCacheService,
  ) {}

  async get1v1Leaderboard(
    page: number,
    region?: string,
    sort: LeaderboardSort = 'rating',
    limit?: number,
  ) {
    const MAX_RANKINGS_PAGES = 200;
    const RANKINGS_PAGE_SIZE = 50;
    const MAX_RANKINGS_ENTRIES = MAX_RANKINGS_PAGES * RANKINGS_PAGE_SIZE;

    const safeTake = Math.min(Math.max(limit ?? 20, 1), 100);
    const requestedPage = Math.max(page || 1, 1);

    const blacklistedIds = this.gameDataCache.getBlacklistedIds();
    const blacklistFilter =
      blacklistedIds.size > 0
        ? { brawlhallaId: { notIn: Array.from(blacklistedIds) } }
        : {};

    const where = {
      ...(region && region !== 'all' ? { region } : {}),
      ...blacklistFilter,
    };

    const safeSort: LeaderboardSort = [
      'rating',
      'wins',
      'games',
      'peakRating',
    ].includes(sort)
      ? sort
      : 'rating';

    const orderBy = { [safeSort]: 'desc' };

    const maxPagesForTake = Math.max(
      1,
      Math.ceil(MAX_RANKINGS_ENTRIES / safeTake),
    );
    const prelimPage = Math.min(requestedPage, maxPagesForTake);

    const total = await this.prisma.player.count({ where });
    const cappedTotal = Math.min(total, MAX_RANKINGS_ENTRIES);
    const totalPages = Math.max(
      1,
      Math.min(Math.ceil(cappedTotal / safeTake), maxPagesForTake),
    );
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
      },
    });

    const enrichedPlayers = players.map((p) => ({
      ...p,
      bestLegendName: p.bestLegend
        ? this.gameDataCache.getBioNameById(p.bestLegend)
        : null,
      bestLegendNameKey: p.bestLegend
        ? this.gameDataCache.getNameKeyById(p.bestLegend)
        : null,
    }));

    return {
      data: enrichedPlayers,
      meta: {
        page: safePage,
        total: cappedTotal,
        totalPages,
      },
    };
  }

  async get2v2Leaderboard(
    page: number,
    region?: string,
    sort: LeaderboardSort = 'rating',
    limit?: number,
  ) {
    const MAX_RANKINGS_PAGES = 200;
    const RANKINGS_PAGE_SIZE = 50;
    const MAX_RANKINGS_ENTRIES = MAX_RANKINGS_PAGES * RANKINGS_PAGE_SIZE;

    const safeTake = Math.min(Math.max(limit ?? 20, 1), 100);
    const requestedPage = Math.max(page || 1, 1);

    const blacklistedIds = this.gameDataCache.getBlacklistedIds();
    const blacklistArray = Array.from(blacklistedIds);
    const blacklistFilter =
      blacklistedIds.size > 0
        ? {
            AND: [
              { brawlhallaIdOne: { notIn: blacklistArray } },
              { brawlhallaIdTwo: { notIn: blacklistArray } },
            ],
          }
        : {};

    const where = {
      ...(region && region !== 'all' ? { region } : {}),
      ...blacklistFilter,
    };

    const safeSort: LeaderboardSort = [
      'rating',
      'wins',
      'games',
      'peakRating',
      'rank',
    ].includes(sort)
      ? sort
      : 'rating';

    const orderBy = [
      { [safeSort]: 'desc' as const },
      { rating: 'desc' as const },
      { peakRating: 'desc' as const },
      { wins: 'desc' as const },
      { games: 'desc' as const },
      { brawlhallaIdOne: 'asc' as const },
      { brawlhallaIdTwo: 'asc' as const },
    ];

    const maxPagesForTake = Math.max(
      1,
      Math.ceil(MAX_RANKINGS_ENTRIES / safeTake),
    );
    const prelimPage = Math.min(requestedPage, maxPagesForTake);

    const total = await this.prisma.ranked2v2Team.count({ where });
    const cappedTotal = Math.min(total, MAX_RANKINGS_ENTRIES);
    const totalPages = Math.max(
      1,
      Math.min(Math.ceil(cappedTotal / safeTake), maxPagesForTake),
    );
    const safePage = Math.min(prelimPage, totalPages);
    const skip = (safePage - 1) * safeTake;

    const teams = await this.prisma.ranked2v2Team.findMany({
      where,
      orderBy,
      take: safeTake,
      skip,
      select: {
        region: true,
        rank: true,
        teamName: true,
        brawlhallaIdOne: true,
        brawlhallaIdTwo: true,
        rating: true,
        peakRating: true,
        tier: true,
        wins: true,
        games: true,
        lastUpdated: true,
      },
    });

    const ids = Array.from(
      new Set(teams.flatMap((t) => [t.brawlhallaIdOne, t.brawlhallaIdTwo])),
    );

    const players = await this.prisma.player.findMany({
      where: { brawlhallaId: { in: ids } },
      select: { brawlhallaId: true, name: true },
    });

    const idToName = new Map(players.map((p) => [p.brawlhallaId, p.name]));
    const enrichedTeams = teams.map((t, i) => ({
      ...t,
      rank: skip + i + 1,
      playerOneName: idToName.get(t.brawlhallaIdOne) ?? null,
      playerTwoName: idToName.get(t.brawlhallaIdTwo) ?? null,
    }));

    return {
      data: enrichedTeams,
      meta: {
        page: safePage,
        total: cappedTotal,
        totalPages,
      },
    };
  }
}
