import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { JANITOR_IDLE_MIN_TOKENS } from '@brawltome/shared-utils';

const MAX_RANKINGS_PAGES = 200;

const GLOBAL_REGION = 'all';
const NON_GLOBAL_REGIONS = [
  'us-e',
  'us-w',
  'eu',
  'sea',
  'aus',
  'brz',
  'jpn',
  'me',
  'sa',
] as const;

// Keep top pages “hot” (refreshed faster than deeper pages).
const GLOBAL_HOT_MAX_PAGE = 20;
const GLOBAL_COLD_START_PAGE = Math.min(
  GLOBAL_HOT_MAX_PAGE + 1,
  MAX_RANKINGS_PAGES
);

// How often to refresh a “cold” page (deeper than the hot set).
const COLD_EVERY_N_TICKS = 8;

// Clan-member stats backfill controls
const CLAN_STATS_ENQUEUE_PER_TICK = 2;
const CLAN_RECENT_WINDOW_MS = 1000 * 60 * 60 * 24; // 24 hours
const CLAN_BACKFILL_QUEUE_BACKLOG_LIMIT = 250;

const JANITOR_LOCK_KEY = 'janitor:performMaintenance';
const JANITOR_LOCK_TTL_MS = 1000 * 60 * 5; // 5 minutes
const JANITOR_LOCK_HEARTBEAT_MS = 1000 * 30; // 30 seconds
const RENEW_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';

const JANITOR_TICK_KEY = 'janitor:tick';

const CURSOR_GLOBAL_1V1_HOT = 'janitor:cursor:global:1v1:hot';
const CURSOR_GLOBAL_2V2_HOT = 'janitor:cursor:global:2v2:hot';
const CURSOR_GLOBAL_1V1_COLD = 'janitor:cursor:global:1v1:cold';
const CURSOR_GLOBAL_2V2_COLD = 'janitor:cursor:global:2v2:cold';

const CURSOR_REGIONAL_1V1_REGION_INDEX =
  'janitor:cursor:regional:1v1:regionIndex';
const CURSOR_REGIONAL_1V1_PAGE = 'janitor:cursor:regional:1v1:page';
const CURSOR_REGIONAL_2V2_REGION_INDEX =
  'janitor:cursor:regional:2v2:regionIndex';
const CURSOR_REGIONAL_2V2_PAGE = 'janitor:cursor:regional:2v2:page';

@Injectable()
export class JanitorService {
  private readonly logger = new Logger(JanitorService.name);

  constructor(
    private bhApiClient: BhApiClientService,
    private prisma: PrismaService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue,
    @Inject(REDIS_CLIENT) private redis: Redis
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async performMaintenance() {
    const lockValue = randomUUID();
    const acquired = await this.redis.set(
      JANITOR_LOCK_KEY,
      lockValue,
      'PX',
      JANITOR_LOCK_TTL_MS,
      'NX'
    );
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
        const renewed = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          JANITOR_LOCK_KEY,
          lockValue,
          String(JANITOR_LOCK_TTL_MS)
        );
        if (renewed !== 1) {
          lockLost = true;
          this.logger.warn(
            'Janitor lock was lost; stopping renewals (another instance may take over)'
          );
        }
      } catch (e) {
        // If renew fails transiently, keep trying; TTL is still a safety net.
        this.logger.warn(
          `Janitor lock renewal failed: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    };

    try {
      const tokens = await this.bhApiClient.getRemainingTokens();

      // Only work if the worker is "idle"
      if (tokens < JANITOR_IDLE_MIN_TOKENS) {
        this.logger.debug(
          `Janitor skipping tick. Tokens: ${tokens} < ${JANITOR_IDLE_MIN_TOKENS}`
        );
        return;
      }

      const tick = await this.redis.incr(JANITOR_TICK_KEY);
      this.logger.log(`Janitor tick=${tick}. Tokens: ${tokens}`);

      // Renew immediately before the heavier work starts.
      await renewOnce();
      if (lockLost) return;

      // 1) Global HOT pages (1..GLOBAL_HOT_MAX_PAGE) for 1v1 and 2v2
      await this.refreshGlobalHotPages();
      await renewOnce();
      if (lockLost) return;

      // 2) Global COLD pages (GLOBAL_COLD_START_PAGE..MAX_RANKINGS_PAGES) slower cadence
      if (tick % COLD_EVERY_N_TICKS === 0) {
        await this.refreshGlobalColdPages();
      }
      await renewOnce();
      if (lockLost) return;

      // 3) Regional rotations (non-global regions only)
      await this.refreshRegionalPages();
      await renewOnce();
      if (lockLost) return;

      // 4) Spend a small budget on clan-member stats backfill
      await this.queueClanMemberMissingStatsRefreshes();
    } finally {
      if (heartbeat) clearInterval(heartbeat);

      // Safe release (compare-and-del) + TTL fallback if worker crashes.
      const releaseScript =
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
      await this.redis
        .eval(releaseScript, 1, JANITOR_LOCK_KEY, lockValue)
        .catch(() => {
          // Ignore release errors; TTL will eventually expire.
        });
    }
  }

  private async getInt(key: string): Promise<number | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  private async setInt(key: string, value: number): Promise<void> {
    await this.redis.set(key, String(value));
  }

  private async getAndAdvanceCursor(
    key: string,
    min: number,
    max: number
  ): Promise<number> {
    const current = (await this.getInt(key)) ?? min;
    const safeCurrent = Math.min(Math.max(current, min), max);
    const next = safeCurrent + 1 > max ? min : safeCurrent + 1;
    await this.setInt(key, next);
    return safeCurrent;
  }

  private async getAndAdvanceRegionalCursor(
    bracket: '1v1' | '2v2'
  ): Promise<{ region: string; page: number }> {
    const regionIndexKey =
      bracket === '1v1'
        ? CURSOR_REGIONAL_1V1_REGION_INDEX
        : CURSOR_REGIONAL_2V2_REGION_INDEX;
    const pageKey =
      bracket === '1v1' ? CURSOR_REGIONAL_1V1_PAGE : CURSOR_REGIONAL_2V2_PAGE;

    const regionIndex = (await this.getInt(regionIndexKey)) ?? 0;
    const page = (await this.getInt(pageKey)) ?? 1;

    const safeRegionIndex =
      ((regionIndex % NON_GLOBAL_REGIONS.length) + NON_GLOBAL_REGIONS.length) %
      NON_GLOBAL_REGIONS.length;
    const safePage = Math.min(Math.max(page, 1), MAX_RANKINGS_PAGES);

    const region = NON_GLOBAL_REGIONS[safeRegionIndex];

    // Advance cursor
    const nextPage = safePage + 1;
    if (nextPage > MAX_RANKINGS_PAGES) {
      await Promise.all([
        this.setInt(pageKey, 1),
        this.setInt(regionIndexKey, safeRegionIndex + 1),
      ]);
    } else {
      await this.setInt(pageKey, nextPage);
    }

    return { region, page: safePage };
  }

  private async refreshGlobalHotPages() {
    const [page1v1, page2v2] = await Promise.all([
      this.getAndAdvanceCursor(CURSOR_GLOBAL_1V1_HOT, 1, GLOBAL_HOT_MAX_PAGE),
      this.getAndAdvanceCursor(CURSOR_GLOBAL_2V2_HOT, 1, GLOBAL_HOT_MAX_PAGE),
    ]);

    await this.refresh1v1Rankings(GLOBAL_REGION, page1v1, 'global-hot');
    await this.refresh2v2Rankings(GLOBAL_REGION, page2v2, 'global-hot');
  }

  private async refreshGlobalColdPages() {
    if (GLOBAL_COLD_START_PAGE > MAX_RANKINGS_PAGES) return;

    const [page1v1, page2v2] = await Promise.all([
      this.getAndAdvanceCursor(
        CURSOR_GLOBAL_1V1_COLD,
        GLOBAL_COLD_START_PAGE,
        MAX_RANKINGS_PAGES
      ),
      this.getAndAdvanceCursor(
        CURSOR_GLOBAL_2V2_COLD,
        GLOBAL_COLD_START_PAGE,
        MAX_RANKINGS_PAGES
      ),
    ]);

    await this.refresh1v1Rankings(GLOBAL_REGION, page1v1, 'global-cold');
    await this.refresh2v2Rankings(GLOBAL_REGION, page2v2, 'global-cold');
  }

  private async refreshRegionalPages() {
    const [one, two] = await Promise.all([
      this.getAndAdvanceRegionalCursor('1v1'),
      this.getAndAdvanceRegionalCursor('2v2'),
    ]);

    await this.refresh1v1Rankings(one.region, one.page, 'regional');
    await this.refresh2v2Rankings(two.region, two.page, 'regional');
  }

  private async refresh1v1Rankings(
    region: string,
    page: number,
    scope: string
  ) {
    try {
      this.logger.log(
        `Refreshing 1v1 rankings (${scope}) region=${region} page=${page}...`
      );
      const rankings = await this.bhApiClient.getRankings('1v1', region, page);

      if (rankings.length > 0) {
        const valid = rankings.filter((p) => Boolean(p.name));
        const ids = valid.map((p) => p.brawlhalla_id);

        const existingPlayers = await this.prisma.player.findMany({
          where: { brawlhallaId: { in: ids } },
          select: { brawlhallaId: true, name: true },
        });
        const existingMap = new Map(
          existingPlayers.map((p) => [p.brawlhallaId, p])
        );

        const now = new Date();
        const operations = valid.map((p) => {
          const existing = existingMap.get(p.brawlhalla_id);

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

          return this.prisma.player.upsert({
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
              bestLegend: p.best_legend,
              bestLegendGames: p.best_legend_games,
              bestLegendWins: p.best_legend_wins,
              lastUpdated: now,
            },
            update: {
              name: p.name,
              ...aliasUpdate,
              region: p.region,
              rating: p.rating,
              peakRating: p.peak_rating,
              tier: p.tier,
              games: p.games,
              wins: p.wins,
              bestLegend: p.best_legend,
              bestLegendGames: p.best_legend_games,
              bestLegendWins: p.best_legend_wins,
              lastUpdated: now,
            },
          });
        });

        await this.prisma.$transaction(operations);
        this.logger.log(
          `Updated ${valid.length} players from 1v1 (${scope}) region=${region} page=${page}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to refresh 1v1 rankings (${scope}) region=${region} page=${page}: ${msg}`
      );
    }
  }

  private async refresh2v2Rankings(
    region: string,
    page: number,
    scope: string
  ) {
    try {
      this.logger.log(
        `Refreshing 2v2 rankings (${scope}) region=${region} page=${page}...`
      );
      const teams = await this.bhApiClient.getRankings('2v2', region, page);

      if (teams.length > 0) {
        const now = new Date();
        const operations = teams.map((t) => {
          const idOne = Math.min(t.brawlhalla_id_one, t.brawlhalla_id_two);
          const idTwo = Math.max(t.brawlhalla_id_one, t.brawlhalla_id_two);

          return this.prisma.ranked2v2Team.upsert({
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
              lastUpdated: now,
            },
            update: {
              rank: t.rank,
              teamName: t.teamname,
              rating: t.rating,
              peakRating: t.peak_rating,
              tier: t.tier,
              wins: t.wins,
              games: t.games,
              lastUpdated: now,
            },
          });
        });

        await this.prisma.$transaction(operations);
        this.logger.log(
          `Updated ${teams.length} teams from 2v2 (${scope}) region=${region} page=${page}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to refresh 2v2 rankings (${scope}) region=${region} page=${page}: ${msg}`
      );
    }
  }

  private async queueClanMemberMissingStatsRefreshes() {
    try {
      const [waiting, delayed, active] = await Promise.all([
        this.refreshQueue.getWaitingCount(),
        this.refreshQueue.getDelayedCount(),
        this.refreshQueue.getActiveCount(),
      ]);
      const backlog = waiting + delayed + active;
      if (backlog > CLAN_BACKFILL_QUEUE_BACKLOG_LIMIT) {
        this.logger.debug(
          `Skipping clan-member stats backfill (queue backlog=${backlog} > ${CLAN_BACKFILL_QUEUE_BACKLOG_LIMIT})`
        );
        return;
      }

      const cutoff = new Date(Date.now() - CLAN_RECENT_WINDOW_MS);
      const clans = await this.prisma.clan.findMany({
        where: { lastUpdated: { gt: cutoff } },
        orderBy: { lastUpdated: 'desc' },
        take: 20,
        select: { clanId: true },
      });
      if (clans.length === 0) return;

      const clanIds = clans.map((c) => c.clanId);
      const members = await this.prisma.clanMember.findMany({
        where: { clanId: { in: clanIds } },
        orderBy: { xp: 'desc' },
        take: 200,
        select: { brawlhallaId: true, name: true },
      });
      if (members.length === 0) return;

      const memberIds = members.map((m) => m.brawlhallaId);
      const existingPlayers = await this.prisma.player.findMany({
        where: { brawlhallaId: { in: memberIds } },
        select: {
          brawlhallaId: true,
          stats: { select: { brawlhallaId: true } },
        },
      });
      const existingById = new Map(
        existingPlayers.map((p) => [p.brawlhallaId, p])
      );

      const needsStats = members.filter((m) => {
        const existing = existingById.get(m.brawlhallaId);
        return !existing || !existing.stats;
      });
      if (needsStats.length === 0) return;

      const toEnqueue = needsStats.slice(0, CLAN_STATS_ENQUEUE_PER_TICK);
      let enqueued = 0;
      const now = new Date();

      for (const m of toEnqueue) {
        const id = m.brawlhallaId;
        const name = (m.name || '').trim();
        if (!name) continue;

        // If a canonical refresh-stats job already exists, avoid duplicate work.
        const canonicalJob = await this.refreshQueue.getJob(
          `refresh-stats-${id}`
        );
        if (canonicalJob) continue;

        // Ensure Player exists (PlayerStats has a required relation to Player)
        await this.prisma.player.upsert({
          where: { brawlhallaId: id },
          create: {
            brawlhallaId: id,
            name,
            region: null,
            rating: 0,
            peakRating: 0,
            tier: 'Unranked',
            games: 0,
            wins: 0,
            lastUpdated: now,
          },
          update: {
            name,
          },
        });

        await this.refreshQueue
          .add(
            'refresh-stats',
            { id },
            {
              // Lower priority (numerically higher) than interactive refreshes.
              priority: 200,
              jobId: `clan-missing-stats-${id}`,
              removeOnComplete: true,
              removeOnFail: true,
            }
          )
          .then(() => {
            enqueued++;
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (
              !msg.toLowerCase().includes('job') ||
              !msg.toLowerCase().includes('exists')
            ) {
              this.logger.warn(
                `Failed to queue clan stats refresh for ${id}`,
                e
              );
            }
          });
      }

      if (enqueued > 0) {
        this.logger.log(
          `Queued ${enqueued} clan-member stats backfills (cap=${CLAN_STATS_ENQUEUE_PER_TICK})`
        );
      }
    } catch (e) {
      this.logger.warn(
        `Clan-member stats backfill failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }
}
