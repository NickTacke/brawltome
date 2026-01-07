import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService, ClanLegendResolverService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import {
  DISCOVERY_MIN_TOKENS,
  PRIORITY_REALTIME,
} from '@brawltome/shared-utils';

// TTL for clan data before it's considered stale
const CLAN_TTL = 1000 * 60 * 60; // 1 hour

@Injectable()
export class ClanService {
  private readonly logger = new Logger(ClanService.name);

  constructor(
    private prisma: PrismaService,
    private bhApiClient: BhApiClientService,
    private clanLegendResolver: ClanLegendResolverService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue
  ) {}

  async getClan(id: number) {
    let clan = await this.prisma.clan.findUnique({
      where: { clanId: id },
      include: {
        members: true,
      },
    });

    const now = Date.now();
    const isStale = clan ? now - clan.lastUpdated.getTime() > CLAN_TTL : true;

    if (!clan) {
      clan = await this.discoverClan(id);
      if (!clan) return null;
    } else if (isStale) {
      void this.queueClanRefresh(id);
    }

    if (!clan?.members?.length) {
      return {
        ...clan,
        isRefreshing: isStale,
      };
    }

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

    const missingLegendKeyIds = clan.members
      .filter((m) => !m.legendNameKey)
      .map((m) => m.brawlhallaId);
    const statsBestLegends =
      missingLegendKeyIds.length > 0
        ? await this.prisma.playerStatsLegend.findMany({
            where: { brawlhallaId: { in: missingLegendKeyIds } },
            orderBy: { xp: 'desc' },
            distinct: ['brawlhallaId'],
            select: { brawlhallaId: true, legendNameKey: true },
          })
        : [];
    const statsLegendKeyById = new Map(
      statsBestLegends.map((l) => [l.brawlhallaId, l.legendNameKey])
    );

    return {
      ...clan,
      isRefreshing: isStale,
      members: clan.members.map((m) => {
        const ranked = ratingById.get(m.brawlhallaId);
        return {
          ...m,
          elo: ranked?.elo ?? null,
          peakElo: ranked?.peakElo ?? null,
          legendNameKey:
            m.legendNameKey ?? statsLegendKeyById.get(m.brawlhallaId) ?? null,
        };
      }),
    };
  }

  private async discoverClan(id: number) {
    const tokens = await this.bhApiClient.getRemainingTokens();
    if (tokens < DISCOVERY_MIN_TOKENS) {
      this.logger.warn(
        `Clan discovery blocked for ${id} due to low tokens (${tokens})`
      );
      throw new HttpException(
        'Server busy. Cannot fetch new clan data right now.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    this.logger.log(`Discovering clan ${id} from API`);
    return this.fetchAndSaveClan(id);
  }

  private async queueClanRefresh(id: number) {
    const jobId = `refresh-clan-${id}`;

    try {
      const existingJob = await this.refreshQueue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'failed') {
          await existingJob.remove();
          this.logger.debug(`Removed failed clan refresh job for ${id}`);
        } else {
          return;
        }
      }

      await this.refreshQueue.add(
        'refresh-clan',
        { id },
        {
          jobId,
          priority: 50,
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
      this.logger.debug(`Queued clan refresh for ${id}`);
    } catch (error) {
      this.logger.warn(`Failed to queue clan refresh for ${id}`, error);
    }
  }

  async fetchAndSaveClan(id: number) {
    try {
      this.logger.log(`Fetching clan ${id} from API...`);
      const clanData = await this.bhApiClient.getClan(id, {
        priority: PRIORITY_REALTIME,
      });

      const memberIds = clanData.clan.map((m) => m.brawlhalla_id);
      const playerLegendMap = await this.clanLegendResolver.resolveBestLegends(
        memberIds
      );

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
