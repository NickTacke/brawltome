import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService, GameDataCacheService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import {
  createWeaponAggregator,
  DISCOVERY_MIN_TOKENS,
  PRIORITY_REALTIME,
  parseDamage,
  mapRankedLegends,
  mapTeams,
} from '@brawltome/shared-utils';

const RANKED_TTL = 1000 * 60 * 60; // 1 hour
const STATS_TTL = 12 * 1000 * 60 * 60; // 12 hours

type PlayerWithRelations = Awaited<
  ReturnType<PlayerService['fetchPlayerWithRelations']>
>;

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name);

  // Track in-flight discovery requests to prevent race conditions
  // Each entry includes a timestamp to enable TTL-based cleanup
  private inFlightDiscoveries: Map<
    number,
    { promise: Promise<PlayerWithRelations | null>; startedAt: number }
  > = new Map();

  // Discovery timeout - cleanup entries older than this
  private static readonly DISCOVERY_TIMEOUT_MS = 30_000; // 30 seconds

  constructor(
    private prisma: PrismaService,
    private gameDataCache: GameDataCacheService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue,
    private bhApiClient: BhApiClientService
  ) {}

  async getPlayer(id: number) {
    if (this.gameDataCache.isBlacklisted(id)) {
      return null;
    }

    let player = await this.prisma.player.findUnique({
      where: { brawlhallaId: id },
      include: {
        aliases: {
          select: {
            key: true,
            value: true,
          },
        },
        stats: {
          include: {
            legends: true,
            clan: true,
            weaponStats: true,
          },
        },
        ranked: {
          include: {
            legends: true,
            teams: true,
          },
        },
      },
    });

    if (!player) {
      player = await this.discoverPlayer(id);
      if (!player) return null;
    }

    void this.incrementViewCount(id);

    const now = Date.now();
    const rankedAge = player.ranked
      ? now - player.ranked.lastUpdated.getTime()
      : Infinity;
    const statsAge = player.stats
      ? now - player.stats.lastUpdated.getTime()
      : Infinity;

    if (rankedAge > RANKED_TTL) {
      try {
        const priority = this.calculatePriority(
          player.viewCount,
          rankedAge,
          'ranked'
        );
        await this.addJob('refresh-ranked', { id }, priority);
      } catch (error) {
        this.logger.error(`Error queuing ranked refresh for ${id}`, error);
      }
    }
    if (statsAge > STATS_TTL) {
      try {
        const priority = this.calculatePriority(
          player.viewCount,
          statsAge,
          'stats'
        );
        await this.addJob('refresh-stats', { id }, priority);
      } catch (error) {
        this.logger.error(`Error queuing stats refresh for ${id}`, error);
      }
    }

    if (player.stats?.legends) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player.stats.legends as any[]) = player.stats.legends.map((l) => ({
        ...l,
        bioName:
          this.gameDataCache.getBioNameByKey(l.legendNameKey) ||
          l.legendNameKey,
        weaponOne: this.gameDataCache.getWeaponsById(l.legendId)?.weaponOne,
        weaponTwo: this.gameDataCache.getWeaponsById(l.legendId)?.weaponTwo,
      }));
    }

    if (player.ranked?.legends) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player.ranked.legends as any[]) = player.ranked.legends.map((l) => ({
        ...l,
        bioName:
          this.gameDataCache.getBioNameByKey(l.legendNameKey) ||
          l.legendNameKey,
        weaponOne: this.gameDataCache.getWeaponsById(l.legendId)?.weaponOne,
        weaponTwo: this.gameDataCache.getWeaponsById(l.legendId)?.weaponTwo,
      }));
    }

    if (player.stats?.legends) {
      const rankedByLegendId = new Map<
        number,
        {
          rating: number;
          peakRating: number;
          tier: string;
          wins: number;
          games: number;
        }
      >();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const rl of (player.ranked?.legends || []) as any[]) {
        rankedByLegendId.set(rl.legendId, {
          rating: rl.rating,
          peakRating: rl.peakRating,
          tier: rl.tier,
          wins: rl.wins,
          games: rl.games,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player.stats as any).legendsEnriched = (
        player.stats.legends as any[]
      ).map((sl) => ({
        ...sl,
        ranked: rankedByLegendId.get(sl.legendId) || null,
      }));
    }

    if (player.stats) {
      const legends = (player.stats.legends || []) as Array<{
        legendId: number;
        matchTime: number;
        timeHeldWeaponOne: number;
        timeHeldWeaponTwo: number;
        damageWeaponOne: string;
        damageWeaponTwo: string;
        KOWeaponOne: number;
        KOWeaponTwo: number;
      }>;

      const playtimeSeconds =
        (player.stats.matchTimeTotal ?? 0) > 0
          ? player.stats.matchTimeTotal
          : legends.reduce((sum, l) => sum + (l.matchTime || 0), 0);
      const weaponAgg = createWeaponAggregator();

      if (player.stats.weaponStats && player.stats.weaponStats.length > 0) {
        for (const w of player.stats.weaponStats as Array<{
          weapon: string;
          timeHeld: number;
          damage: string;
          KOs: number;
        }>) {
          weaponAgg.add(w.weapon, w.timeHeld, parseDamage(w.damage), w.KOs);
        }
      } else {
        for (const l of legends) {
          const weapons = this.gameDataCache.getWeaponsById(l.legendId);
          if (!weapons) continue;
          weaponAgg.add(
            weapons.weaponOne,
            l.timeHeldWeaponOne || 0,
            parseDamage(l.damageWeaponOne),
            l.KOWeaponOne || 0
          );
          weaponAgg.add(
            weapons.weaponTwo,
            l.timeHeldWeaponTwo || 0,
            parseDamage(l.damageWeaponTwo),
            l.KOWeaponTwo || 0
          );
        }
      }

      const weaponStats = Array.from(weaponAgg.values())
        .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
        .sort((a, b) => b.timeHeld - a.timeHeld);

      const totalTimeHeld = weaponStats.reduce((sum, w) => sum + w.timeHeld, 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player.stats as any).playtimeSeconds = playtimeSeconds;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (player.stats as any).weaponStats = weaponStats.map((w) => ({
        weapon: w.weapon,
        timeHeld: w.timeHeld,
        damage: String(w.damage),
        KOs: w.KOs,
        share: totalTimeHeld > 0 ? w.timeHeld / totalTimeHeld : 0,
      }));
    }

    return {
      ...player,
      isRefreshing: rankedAge > RANKED_TTL || statsAge > STATS_TTL,
    };
  }

  private async discoverPlayer(
    id: number
  ): Promise<PlayerWithRelations | null> {
    if (this.gameDataCache.isBlacklisted(id)) {
      return null;
    }

    // Cleanup stale entries to prevent memory leaks
    this.cleanupStaleDiscoveries();

    const existingDiscovery = this.inFlightDiscoveries.get(id);
    if (existingDiscovery) {
      this.logger.debug(`Joining existing discovery for player ${id}`);
      return existingDiscovery.promise;
    }

    const discoveryPromise = this.executeDiscovery(id);
    this.inFlightDiscoveries.set(id, {
      promise: discoveryPromise,
      startedAt: Date.now(),
    });

    try {
      return await discoveryPromise;
    } finally {
      this.inFlightDiscoveries.delete(id);
    }
  }

  /**
   * Remove discovery entries that have been running longer than the timeout.
   * This prevents memory leaks from promises that never resolve.
   */
  private cleanupStaleDiscoveries(): void {
    const now = Date.now();
    for (const [id, entry] of this.inFlightDiscoveries) {
      if (now - entry.startedAt > PlayerService.DISCOVERY_TIMEOUT_MS) {
        this.logger.warn(
          `Removing stale discovery for player ${id} (exceeded ${PlayerService.DISCOVERY_TIMEOUT_MS}ms)`
        );
        this.inFlightDiscoveries.delete(id);
      }
    }
  }

  private async executeDiscovery(
    id: number
  ): Promise<PlayerWithRelations | null> {
    const tokens = await this.bhApiClient.getRemainingTokens();
    if (tokens < DISCOVERY_MIN_TOKENS) {
      this.logger.warn(
        `Discovery blocked for ${id} due to low tokens (${tokens})`
      );
      throw new HttpException(
        'Server busy. Cannot fetch new player data right now.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    this.logger.log(`Discovering player ${id} from API`);

    try {
      let name = '';
      let region = 'UNKNOWN';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rankedData: any = {};

      try {
        const statsData = await this.bhApiClient.getPlayerStats(id, {
          priority: PRIORITY_REALTIME,
        });
        name = statsData.name || '';
      } catch (e) {
        this.logger.warn(`Failed to fetch stats for ${id}: ${e}`);
      }

      if (!name) {
        this.logger.warn(`Could not find name for player ${id} in stats.`);
        return null;
      }

      try {
        rankedData = await this.bhApiClient.getPlayerRanked(id, {
          priority: PRIORITY_REALTIME,
        });
        region = rankedData.region || 'UNKNOWN';
      } catch (e) {
        this.logger.warn(
          `Failed to fetch ranked data for ${id}, using default values. ${e}`
        );
      }

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
              lastUpdated: new Date(),
              legends: {
                deleteMany: {},
                create: mapRankedLegends(rankedData.legends),
              },
              teams: {
                deleteMany: {},
                create: mapTeams(rankedData['2v2']),
              },
            },
            create: {
              brawlhallaId: id,
              lastUpdated: new Date(),
              legends: {
                create: mapRankedLegends(rankedData.legends),
              },
              teams: {
                create: mapTeams(rankedData['2v2']),
              },
            },
          });
        }
      });

      await this.refreshQueue.add('refresh-stats', { id });
      if (rankedData.legends) {
        await this.refreshQueue.add('refresh-ranked', { id });
      }

      return this.fetchPlayerWithRelations(id);
    } catch (error) {
      this.logger.warn(`Failed to discover player ${id}: ${error}`);
      return null;
    }
  }

  private fetchPlayerWithRelations(id: number) {
    return this.prisma.player.findUnique({
      where: { brawlhallaId: id },
      include: {
        aliases: {
          select: {
            key: true,
            value: true,
          },
        },
        stats: {
          include: {
            legends: true,
            clan: true,
            weaponStats: true,
          },
        },
        ranked: {
          include: {
            legends: true,
            teams: true,
          },
        },
      },
    });
  }

  private async addJob(name: string, data: { id: number }, priority: number) {
    const jobId = `${name}-${data.id}`;
    const job = await this.refreshQueue.getJob(jobId);

    if (job) {
      const state = await job.getState();
      if (state === 'failed') {
        await job.remove();
        this.logger.warn(`Removed failed job ${jobId} to re-queue`);
      } else {
        return;
      }
    }

    try {
      await this.refreshQueue.add(name, data, {
        jobId,
        priority,
        removeOnComplete: true,
        removeOnFail: true, // Auto-remove on fail to prevent "stuck" jobs if our manual check misses something
      });
      this.logger.debug(
        `Queued ${name} for ${data.id} with priority ${priority}`
      );
    } catch (error: any) {
      if (!error.message?.includes('already exists')) {
        this.logger.error(`Error queuing ${name} for ${data.id}`, error);
      }
    }
  }

  private async incrementViewCount(id: number) {
    try {
      await this.prisma.player.update({
        where: { brawlhallaId: id },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
    } catch (error) {
      this.logger.debug(`Failed to increment view count for ${id}: ${error}`);
    }
  }

  // Priority helper - Lower is better
  private calculatePriority(
    viewCount: number,
    ageMs: number,
    type: 'ranked' | 'stats'
  ): number {
    let priority = Math.max(1, 100 - Math.floor(Math.sqrt(viewCount))); // Base priority based on view count
    if (ageMs > 1000 * 60 * 60 * 24) priority -= 20; // If data is really old, boost priority
    if (type === 'stats') priority += 10; // Stats are less important than ranked
    return Math.max(1, Math.min(100, priority));
  }
}
