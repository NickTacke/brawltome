import { Injectable } from '@nestjs/common';
import { PrismaService } from '@brawltome/database';

type LeaderboardSort = 'rating' | 'wins' | 'games' | 'peakRating' | 'rank';

@Injectable()
export class LeaderboardService {
  constructor(private prisma: PrismaService) {}

  async get2v2Leaderboard(
    page: number,
    region?: string,
    sort: LeaderboardSort = 'rating',
    limit?: number
  ) {
    const MAX_RANKINGS_PAGES = 200; // How many BHAPI pages the janitor keeps fresh
    const RANKINGS_PAGE_SIZE = 50; // BHAPI rankings page size
    const MAX_RANKINGS_ENTRIES = MAX_RANKINGS_PAGES * RANKINGS_PAGE_SIZE;

    const safeTake = Math.min(Math.max(limit ?? 20, 1), 100);
    const requestedPage = Math.max(page || 1, 1);

    const where = region && region !== 'all' ? { region } : {};

    const safeSort: LeaderboardSort = ['rating', 'wins', 'games', 'peakRating', 'rank'].includes(sort)
      ? sort
      : 'rating';

    const orderBy = [
      { [safeSort]: 'desc' as const },
      // Tie-breakers for stable ordering across pages/refreshes
      { rating: 'desc' as const },
      { peakRating: 'desc' as const },
      { wins: 'desc' as const },
      { games: 'desc' as const },
      { brawlhallaIdOne: 'asc' as const },
      { brawlhallaIdTwo: 'asc' as const },
    ];

    const maxPagesForTake = Math.max(1, Math.ceil(MAX_RANKINGS_ENTRIES / safeTake));
    const prelimPage = Math.min(requestedPage, maxPagesForTake);

    const total = await this.prisma.ranked2v2Team.count({ where });
    const cappedTotal = Math.min(total, MAX_RANKINGS_ENTRIES);
    const totalPages = Math.max(1, Math.min(Math.ceil(cappedTotal / safeTake), maxPagesForTake));
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
      new Set(teams.flatMap((t) => [t.brawlhallaIdOne, t.brawlhallaIdTwo]))
    );

    const players = await this.prisma.player.findMany({
      where: { brawlhallaId: { in: ids } },
      select: { brawlhallaId: true, name: true },
    });

    const idToName = new Map(players.map((p) => [p.brawlhallaId, p.name]));
    const enrichedTeams = teams.map((t, i) => ({
      ...t,
      // IMPORTANT: rank is computed from our DB ordering (region+sort+page), not the API ladder rank
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