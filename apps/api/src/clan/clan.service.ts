import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';

@Injectable()
export class ClanService {
  private readonly logger = new Logger(ClanService.name);

  constructor(
    private prisma: PrismaService,
    private bhApiClient: BhApiClientService
  ) {}

  async getClan(id: number) {
    // Fetch Clan from database
    let clan = await this.prisma.clan.findUnique({
      where: { clanId: id },
      include: {
        members: true,
      },
    });

    const now = Date.now();
    const MAX_AGE = 1000 * 60 * 60; // 1 hour

    // If not found or stale, refresh
    if (!clan || now - clan.lastUpdated.getTime() > MAX_AGE) {
      try {
        clan = await this.fetchAndSaveClan(id);
      } catch (error) {
        // If API fails but we have stale data, return stale data
        if (clan) {
          this.logger.warn(
            `Failed to refresh clan ${id}, returning stale data`,
            error
          );
        } else {
          throw error;
        }
      }
    }

    if (!clan?.members?.length) return clan;

    // Enrich clan members with overall 1v1 Elo (Player.rating) and peak rating.
    // Some members may not exist in the Player table yet; those will return null.
    const memberIds = clan.members.map((m) => m.brawlhallaId);
    const players = await this.prisma.player.findMany({
      where: { brawlhallaId: { in: memberIds } },
      select: { brawlhallaId: true, rating: true, peakRating: true },
    });

    const ratingById = new Map(
      players.map((p) => [
        p.brawlhallaId,
        {
          elo: p.rating && p.rating > 0 ? p.rating : null,
          peakElo: p.peakRating && p.peakRating > 0 ? p.peakRating : null,
        },
      ])
    );

    return {
      ...clan,
      members: clan.members.map((m) => {
        const ranked = ratingById.get(m.brawlhallaId);
        return {
          ...m,
          elo: ranked?.elo ?? null,
          peakElo: ranked?.peakElo ?? null,
        };
      }),
    };
  }

  private async fetchAndSaveClan(id: number) {
    try {
      this.logger.log(`Fetching clan ${id} from API...`);
      const clanData = await this.bhApiClient.getClan(id);

      // Get all brawlhallaIds
      const memberIds = clanData.clan.map((m) => m.brawlhalla_id);

      const bestLegends = await this.prisma.playerRankedLegend.findMany({
        where: {
          brawlhallaId: { in: memberIds },
        },
        orderBy: {
          rating: 'desc',
        },
        distinct: ['brawlhallaId'],
        select: {
          brawlhallaId: true,
          legendId: true,
        },
      });

      // Now get the legendNameKeys for these legendIds
      const legendIds = bestLegends.map((bl) => bl.legendId);
      const legends = await this.prisma.legend.findMany({
        where: { legendId: { in: legendIds } },
        select: { legendId: true, legendNameKey: true },
      });

      const legendKeyMap = new Map(
        legends.map((l) => [l.legendId, l.legendNameKey])
      );
      const playerLegendMap = new Map();

      for (const bl of bestLegends) {
        const legendNameKey = legendKeyMap.get(bl.legendId);
        if (legendNameKey) {
          playerLegendMap.set(bl.brawlhallaId, legendNameKey);
        }
      }

      // Save to DB
      const clan = await this.prisma.clan.upsert({
        where: { clanId: id },
        create: {
          clanId: clanData.clan_id,
          clanName: clanData.clan_name,
          clanCreateDate: new Date(clanData.clan_create_date * 1000),
          clanXp: clanData.clan_xp,
          clanLifetimeXp: clanData.clan_lifetime_xp,
          lastUpdated: new Date(),
          members: {
            create: clanData.clan.map((m) => ({
              brawlhallaId: m.brawlhalla_id,
              name: m.name,
              rank: m.rank,
              joinDate: new Date(m.join_date * 1000),
              xp: m.xp,
              legendNameKey: playerLegendMap.get(m.brawlhalla_id) || null,
            })),
          },
        },
        update: {
          clanName: clanData.clan_name,
          clanXp: clanData.clan_xp,
          clanLifetimeXp: clanData.clan_lifetime_xp,
          lastUpdated: new Date(),
          members: {
            deleteMany: {},
            create: clanData.clan.map((m) => ({
              brawlhallaId: m.brawlhalla_id,
              name: m.name,
              rank: m.rank,
              joinDate: new Date(m.join_date * 1000),
              xp: m.xp,
              legendNameKey: playerLegendMap.get(m.brawlhalla_id) || null,
            })),
          },
        },
        include: { members: true },
      });

      return clan;
    } catch (e) {
      this.logger.error(`Failed to fetch clan ${id}`, e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (e as any).response?.status;
      if (status === 404) {
        throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch clan',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
