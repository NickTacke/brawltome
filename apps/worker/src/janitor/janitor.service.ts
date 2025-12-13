import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';

const IDLE_TOKEN_THRESHOLD = 100; // Only run if we have plenty of tokens
const MAX_RANKINGS_PAGES = 200;

const JANITOR_LOCK_KEY = 'janitor:performMaintenance';
const JANITOR_LOCK_TTL_MS = 1000 * 60 * 5; // 5 minutes
const JANITOR_LOCK_HEARTBEAT_MS = 1000 * 30; // 30 seconds
const RENEW_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';

@Injectable()
export class JanitorService {
  private readonly logger = new Logger(JanitorService.name);
  private current1v1Page = 1;
  private current2v2Page = 1;

  constructor(
    private bhApiClient: BhApiClientService,
    private prisma: PrismaService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue,
    @Inject(REDIS_CLIENT) private redis: Redis
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async performMaintenance() {
    const lockValue = randomUUID();
    const acquired = await this.redis.set(JANITOR_LOCK_KEY, lockValue, 'PX', JANITOR_LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      this.logger.debug('Janitor lock not acquired; skipping this tick');
      return;
    }

    const heartbeat = setInterval(() => {
      void renewOnce();
    }, JANITOR_LOCK_HEARTBEAT_MS);
    let lockLost = false;

    const renewOnce = async () => {
      try {
        const renewed = await this.redis.eval(RENEW_SCRIPT, 1, JANITOR_LOCK_KEY, lockValue, String(JANITOR_LOCK_TTL_MS));
        if (renewed !== 1) {
          lockLost = true;
          this.logger.warn('Janitor lock was lost; stopping renewals (another instance may take over)');
        }
      } catch (e) {
        // If renew fails transiently, keep trying; TTL is still a safety net.
        this.logger.warn(`Janitor lock renewal failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    try {
      const tokens = await this.bhApiClient.getRemainingTokens();

      // Only work if the worker is "idle"
      if (tokens < IDLE_TOKEN_THRESHOLD) {
        this.logger.debug(`Janitor sleeping. Tokens: ${tokens} < ${IDLE_TOKEN_THRESHOLD}`);
        return;
      }

      this.logger.log(`🧹 Janitor waking up! Tokens: ${tokens}`);

      // Renew immediately before the heavier work starts.
      await renewOnce();
      if (lockLost) return;

      await this.refresh1v1RankingsPage();
      await renewOnce();
      if (lockLost) return;

      await this.refresh2v2RankingsPage();
      await renewOnce();
      if (lockLost) return;

      await this.queueMissingDataRefreshes();
      // TODO: After missing data is filled, start refreshing clans
    } finally {
      if (heartbeat) clearInterval(heartbeat);

      // Safe release (compare-and-del) + TTL fallback if worker crashes.
      const releaseScript =
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
      await this.redis.eval(releaseScript, 1, JANITOR_LOCK_KEY, lockValue).catch(() => {
        // Ignore release errors; TTL will eventually expire.
      });
    }
  }

  private async refresh1v1RankingsPage() {
    try {
      this.logger.log(`Refreshing 1v1 rankings page ${this.current1v1Page}...`);
      const rankings = await this.bhApiClient.getRankings('1v1', 'all', this.current1v1Page);

      if (rankings.length > 0) {
        for (const p of rankings) {
          // Skip if name is missing / shouldn't really happen
          if (!p.name) continue;

          const existing = await this.prisma.player.findUnique({
            where: { brawlhallaId: p.brawlhalla_id },
            select: { name: true, brawlhallaId: true },
          });

          const aliasUpdate =
            existing && existing.name !== p.name
              ? {
                  aliases: {
                    upsert: {
                      where: {
                        brawlhallaId_key: {
                          brawlhallaId: existing.brawlhallaId,
                          key: existing.name.toLowerCase(),
                        },
                      },
                      create: {
                        key: existing.name.toLowerCase(),
                        value: existing.name,
                      },
                      update: {},
                    },
                  },
                }
              : {};

          await this.prisma.player.upsert({
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
              lastUpdated: new Date(),
            },
            update: {
              name: p.name,
              ...aliasUpdate,
              rating: p.rating,
              peakRating: p.peak_rating,
              tier: p.tier,
              games: p.games,
              wins: p.wins,
              lastUpdated: new Date(),
            },
          });
        }
        this.logger.log(`Updated ${rankings.length} players from 1v1 page ${this.current1v1Page}`);
      }

      // Cycle pages (1..MAX_RANKINGS_PAGES)
      this.current1v1Page++;
      if (this.current1v1Page > MAX_RANKINGS_PAGES) {
        this.current1v1Page = 1;
      }
    } catch (error) {
      this.logger.error(`Failed to refresh 1v1 rankings page ${this.current1v1Page}`, error);
    }
  }

  private async refresh2v2RankingsPage() {
    try {
      this.logger.log(`Refreshing 2v2 rankings page ${this.current2v2Page}...`);
      const teams = await this.bhApiClient.getRankings('2v2', 'all', this.current2v2Page);

      if (teams.length > 0) {
        for (const t of teams) {
          const idOne = Math.min(t.brawlhalla_id_one, t.brawlhalla_id_two);
          const idTwo = Math.max(t.brawlhalla_id_one, t.brawlhalla_id_two);

          await this.prisma.ranked2v2Team.upsert({
            where: {
              region_brawlhallaIdOne_brawlhallaIdTwo: {
                region: t.region,
                brawlhallaIdOne: idOne,
                brawlhallaIdTwo: idTwo,
              },
            },
            create: {
              region: t.region,
              brawlhallaIdOne: idOne,
              brawlhallaIdTwo: idTwo,
              rank: t.rank,
              teamName: t.teamname,
              rating: t.rating,
              peakRating: t.peak_rating,
              tier: t.tier,
              wins: t.wins,
              games: t.games,
              lastUpdated: new Date(),
            },
            update: {
              rank: t.rank,
              teamName: t.teamname,
              rating: t.rating,
              peakRating: t.peak_rating,
              tier: t.tier,
              wins: t.wins,
              games: t.games,
              lastUpdated: new Date(),
            },
          });
        }
        this.logger.log(`Updated ${teams.length} teams from 2v2 page ${this.current2v2Page}`);
      }

      this.current2v2Page++;
      if (this.current2v2Page > MAX_RANKINGS_PAGES) {
        this.current2v2Page = 1;
      }
    } catch (error) {
      this.logger.error(`Failed to refresh 2v2 rankings page ${this.current2v2Page}`, error);
    }
  }

  private async queueMissingDataRefreshes() {
    const missingDataPlayers = await this.prisma.player.findMany({
      where: {
        OR: [{ stats: null }, { ranked: null }],
      },
      orderBy: { rating: 'desc' },
      take: 10,
      include: {
        stats: { select: { brawlhallaId: true } },
        ranked: { select: { brawlhallaId: true } },
      },
    });

    if (missingDataPlayers.length > 0) {
      this.logger.log(`Found ${missingDataPlayers.length} players with missing data. Queuing...`);
      for (const p of missingDataPlayers) {
        if (!p.stats) {
          await this.refreshQueue
            .add('refresh-stats', { id: p.brawlhallaId }, {
              priority: 100,
              jobId: `missing-stats-${p.brawlhallaId}`, // Deduplication
              removeOnComplete: true,
              removeOnFail: true,
            })
            .catch(() => {
              // Ignore duplicate job errors
            });
        }
        if (!p.ranked) {
          await this.refreshQueue
            .add('refresh-ranked', { id: p.brawlhallaId }, {
              priority: 100,
              jobId: `missing-ranked-${p.brawlhallaId}`,
              removeOnComplete: true,
              removeOnFail: true,
            })
            .catch(() => {
              // Ignore duplicate job errors
            });
        }
      }
    }
  }
}