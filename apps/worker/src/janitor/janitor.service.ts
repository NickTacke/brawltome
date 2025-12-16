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
import {
  REGIONS,
  Region,
  PlayerDTO,
  Ranked2v2TeamDTO,
} from '@brawltome/shared-types';

const CONFIG = {
  PAGES: {
    MAX: 200,
    HOT_MAX: 20,
    COLD_START: 21,
  },
  TICKS: {
    COLD_INTERVAL: 8,
    CLAN_ENQUEUE_LIMIT: 2,
    CLAN_MAX_BACKLOG: 100,
  },
  LOCK: {
    KEY: 'janitor:performMaintenance',
    TTL: 1000 * 60 * 5, // 5 minutes
    HEARTBEAT: 1000 * 30, // 30 seconds
  },
  KEYS: {
    TICK_COUNTER: 'janitor:tick',
    CURSORS: {
      GLOBAL_1V1_HOT: 'janitor:cursor:global:1v1:hot',
      GLOBAL_2V2_HOT: 'janitor:cursor:global:2v2:hot',
      GLOBAL_1V1_COLD: 'janitor:cursor:global:1v1:cold',
      GLOBAL_2V2_COLD: 'janitor:cursor:global:2v2:cold',
      REGIONAL_1V1_REGION_INDEX: 'janitor:cursor:regional:1v1:regionIndex',
      REGIONAL_1V1_PAGE: 'janitor:cursor:regional:1v1:page',
      REGIONAL_2V2_REGION_INDEX: 'janitor:cursor:regional:2v2:regionIndex',
      REGIONAL_2V2_PAGE: 'janitor:cursor:regional:2v2:page',
    },
  },
};

const GLOBAL_REGION = 'all';
const FILTERED_REGIONS = REGIONS.filter((r) => r !== GLOBAL_REGION);

// Helper types for cursor handling
type Bracket = '1v1' | '2v2';
type Scope = 'global-hot' | 'global-cold' | 'regional';

@Injectable()
export class JanitorService {
  private readonly logger = new Logger(JanitorService.name);

  // Redis scripts
  private readonly SCRIPTS = {
    RENEW: `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`,
    RELEASE: `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
  };

  constructor(
    private bhApiClient: BhApiClientService,
    private prisma: PrismaService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue,
    @Inject(REDIS_CLIENT) private redis: Redis
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async performMaintenance() {
    // Run logic inside lock wrapper
    await this.runWithLock(async (renewLock) => {
      // Resource check
      const tokens = await this.bhApiClient.getRemainingTokens();
      if (tokens < JANITOR_IDLE_MIN_TOKENS) {
        this.logger.log(
          `Not enough tokens to perform maintenance, skipping...`
        );
        return;
      }

      const tick = await this.redis.incr(CONFIG.KEYS.TICK_COUNTER);
      this.logger.log(`Janitor tick ${tick} started. Tokens: ${tokens}`);

      // Execution pipeline (renew lock inbetween)
      await renewLock();

      // Hot pages (Always run)
      await this.processRankingBatch('global-hot');
      await renewLock();

      // Cold pages (Run every 8 ticks)
      if (tick % CONFIG.TICKS.COLD_INTERVAL === 0) {
        await this.processRankingBatch('global-cold');
      }
      await renewLock();

      // Regional rotations
      await this.processRankingBatch('regional');
      await renewLock();

      // Clan backfill
      await this.processClanBackfill();
    });
  }

  /**
   * Orchestrates fetching for both 1v1 and 2v2 based on scope
   */
  private async processRankingBatch(scope: Scope) {
    // Parallelize 1v1 and 2v2 fetches for this scope
    await Promise.all([
      this.syncBracket('1v1', scope),
      this.syncBracket('2v2', scope),
    ]);
  }

  /**
   * Generic handler for rankings bracket syncing
   */
  private async syncBracket(bracket: Bracket, scope: Scope) {
    const { region, page } = await this.getNextCursor(bracket, scope);

    // Safety check for pagination
    if (page > CONFIG.PAGES.MAX) return;

    try {
      this.logger.log(
        `Syncing ${bracket} ${scope} for region ${region} page ${page}`
      );

      if (bracket === '1v1') {
        const data = await this.bhApiClient.getRankings('1v1', region, page);
        await this.savePlayers(data, region);
      } else if (bracket === '2v2') {
        const data = await this.bhApiClient.getRankings('2v2', region, page);
        await this.saveTeams(data, region);
      }
    } catch (error) {
      this.logger.error(
        `Error syncing ${bracket} ${scope} for region ${region} page ${page}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // --- Database logic ---

  private async savePlayers(players: PlayerDTO[], region: Region) {
    if (!players.length) return;

    const valid = players.filter((p) => !!p.name);
    const ids = valid.map((p) => p.brawlhalla_id);

    // Fetch existing players for alias comparison
    const existing = await this.prisma.player.findMany({
      where: { brawlhallaId: { in: ids } },
      select: { brawlhallaId: true, name: true },
    });
    const existingMap = new Map(existing.map((p) => [p.brawlhallaId, p.name]));
    const now = new Date();

    const operations = valid.map((p) => {
      const oldName = existingMap.get(p.brawlhalla_id);
      const hasNameChanged =
        oldName && oldName.trim().length > 0 && oldName !== p.name;

      const data = {
        name: p.name,
        region: p.region.toUpperCase(),
        rating: p.rating,
        peakRating: p.peak_rating,
        tier: p.tier,
        games: p.games,
        wins: p.wins,
        bestLegend: p.best_legend,
        bestLegendGames: p.best_legend_games,
        bestLegendWins: p.best_legend_wins,
        lastUpdated: now,
      };

      return this.prisma.player.upsert({
        where: { brawlhallaId: p.brawlhalla_id },
        create: { brawlhallaId: p.brawlhalla_id, ...data },
        update: {
          ...data,
          aliases: hasNameChanged
            ? {
                upsert: {
                  where: {
                    brawlhallaId_key: {
                      brawlhallaId: p.brawlhalla_id,
                      key: oldName.toLowerCase(),
                    },
                  },
                  create: {
                    key: oldName.toLowerCase(),
                    value: oldName,
                  },
                  update: {},
                },
              }
            : undefined,
        },
      });
    });

    await this.prisma.$transaction(operations);
    this.logger.log(`Saved ${valid.length} players for region ${region}`);
  }

  private async saveTeams(teams: Ranked2v2TeamDTO[], region: Region) {
    if (!teams.length) return;
    const now = new Date();

    const operations = teams.map((t) => {
      const idOne = Math.min(t.brawlhalla_id_one, t.brawlhalla_id_two);
      const idTwo = Math.max(t.brawlhalla_id_one, t.brawlhalla_id_two);
      const actualRegion = t.region.toUpperCase();

      const data = {
        rank: t.rank,
        teamName: t.teamname,
        rating: t.rating,
        peakRating: t.peak_rating,
        tier: t.tier,
        wins: t.wins,
        games: t.games,
        lastUpdated: now,
      };

      return this.prisma.ranked2v2Team.upsert({
        where: {
          region_brawlhallaIdOne_brawlhallaIdTwo: {
            region: actualRegion,
            brawlhallaIdOne: idOne,
            brawlhallaIdTwo: idTwo,
          },
        },
        create: {
          region: actualRegion,
          brawlhallaIdOne: idOne,
          brawlhallaIdTwo: idTwo,
          ...data,
        },
        update: data,
      });
    });

    await this.prisma.$transaction(operations);
    this.logger.log(`Saved ${teams.length} 2v2 teams for region ${region}`);
  }

  // --- Specialized Clan logic ---

  private async processClanBackfill() {
    try {
      const qCounts = await this.refreshQueue.getJobCounts(
        'waiting',
        'delayed',
        'active'
      );
      const backlog = qCounts.waiting + qCounts.delayed + qCounts.active;

      if (backlog > CONFIG.TICKS.CLAN_MAX_BACKLOG) {
        this.logger.log(
          `Clan backfill skipped, backlog ${backlog} exceeds limit ${CONFIG.TICKS.CLAN_MAX_BACKLOG}`
        );
        return;
      }

      // Find clans updated recently
      const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24);
      const clans = await this.prisma.clan.findMany({
        where: { lastUpdated: { gte: cutoff } },
        orderBy: { lastUpdated: 'desc' },
        take: 20,
        select: { clanId: true },
      });

      if (!clans.length) return;

      // Find members of those clans
      const members = await this.prisma.clanMember.findMany({
        where: { clanId: { in: clans.map((c) => c.clanId) } },
        orderBy: { xp: 'desc' },
        take: 200,
        select: { brawlhallaId: true, name: true },
      });

      // Find which members are missing stats
      const existingStats = await this.prisma.playerStats.findMany({
        where: { brawlhallaId: { in: members.map((m) => m.brawlhallaId) } },
        select: { brawlhallaId: true },
      });
      const existingIds = new Set(existingStats.map((s) => s.brawlhallaId));

      // Filter out members that already have stats
      const candidates = members.filter(
        (m) => !existingIds.has(m.brawlhallaId)
      );

      let queued = 0;
      for (const member of candidates.slice(
        0,
        CONFIG.TICKS.CLAN_ENQUEUE_LIMIT
      )) {
        await this.ensurePlayerAndQueue(member.brawlhallaId, member.name);
        queued++;
      }

      if (queued > 0)
        this.logger.log(`Queued ${queued} clan members for stats backfill`);
    } catch (error) {
      this.logger.warn('Error processing clan backfill:', error);
    }
  }

  private async ensurePlayerAndQueue(id: number, name?: string) {
    if (!name) return;

    // Create base player record if missing
    await this.prisma.player.upsert({
      where: { brawlhallaId: id },
      create: {
        brawlhallaId: id,
        name: name,
        region: null,
        rating: 0,
        peakRating: 0,
        tier: 'Unranked',
        games: 0,
        wins: 0,
        lastUpdated: new Date(),
      },
      update: { name },
    });

    await this.refreshQueue
      .add(
        'refresh-stats',
        { id },
        {
          jobId: `clan-missing-stats-${id}`,
          removeOnComplete: true,
          removeOnFail: true,
          priority: 100,
        }
      )
      .catch(() => null); // Ignore dupe job errors
  }

  // --- Infrastructure helpers ---

  /**
   * Calculates the next region/page combination based on Redis state
   */
  private async getNextCursor(
    bracket: Bracket,
    scope: Scope
  ): Promise<{ region: Region; page: number }> {
    if (scope === 'global-hot') {
      const key =
        bracket === '1v1'
          ? CONFIG.KEYS.CURSORS.GLOBAL_1V1_HOT
          : CONFIG.KEYS.CURSORS.GLOBAL_2V2_HOT;
      return {
        region: GLOBAL_REGION,
        page: await this.incrementCursor(key, 1, CONFIG.PAGES.HOT_MAX),
      };
    }

    if (scope === 'global-cold') {
      const key =
        bracket === '1v1'
          ? CONFIG.KEYS.CURSORS.GLOBAL_1V1_COLD
          : CONFIG.KEYS.CURSORS.GLOBAL_2V2_COLD;
      return {
        region: GLOBAL_REGION,
        page: await this.incrementCursor(
          key,
          CONFIG.PAGES.COLD_START,
          CONFIG.PAGES.MAX
        ),
      };
    }

    // Regional logic
    const indexKey =
      bracket === '1v1'
        ? CONFIG.KEYS.CURSORS.REGIONAL_1V1_REGION_INDEX
        : CONFIG.KEYS.CURSORS.REGIONAL_2V2_REGION_INDEX;
    const pageKey =
      bracket === '1v1'
        ? CONFIG.KEYS.CURSORS.REGIONAL_1V1_PAGE
        : CONFIG.KEYS.CURSORS.REGIONAL_2V2_PAGE;

    let index = Number(await this.redis.get(indexKey)) || 0;
    const page = Number(await this.redis.get(pageKey)) || 1;

    // Ensure bounds
    index = index % FILTERED_REGIONS.length;

    // Advance index and page
    if (page >= CONFIG.PAGES.MAX) {
      await this.redis.set(pageKey, 1);
      await this.redis.set(indexKey, (index + 1) % FILTERED_REGIONS.length);
    } else {
      await this.redis.incr(pageKey);
    }

    // Return result
    return { region: FILTERED_REGIONS[index], page };
  }

  private async incrementCursor(
    key: string,
    min: number,
    max: number
  ): Promise<number> {
    const raw = await this.redis.get(key);
    let current = raw ? parseInt(raw, 10) : min;

    // Clamp min < current < max
    if (current < min) current = min;
    if (current > max) current = max;

    const usedValue = current;
    const next = current + 1 > max ? min : current + 1;

    await this.redis.set(key, next);
    return usedValue;
  }

  /**
   * Wrapper for distributed lock using Redis.
   */
  private async runWithLock(
    callback: (renewer: () => Promise<void>) => Promise<void>
  ) {
    const lockValue = randomUUID();
    const acquired = await this.redis.set(
      CONFIG.LOCK.KEY,
      lockValue,
      'PX',
      CONFIG.LOCK.TTL,
      'NX'
    );

    if (acquired !== 'OK') {
      this.logger.debug('Lock busy, skipping');
      return;
    }

    // Heartbeat to keep the lock alive while working
    let active = true;
    const interval = setInterval(() => renew(), CONFIG.LOCK.HEARTBEAT);

    const renew = async () => {
      if (!active) return;
      try {
        const result = await this.redis.eval(
          this.SCRIPTS.RENEW,
          1,
          CONFIG.LOCK.KEY,
          lockValue,
          String(CONFIG.LOCK.TTL)
        );
        if (result !== 1) {
          active = false;
          this.logger.debug('Lock lost, skipping');
        }
      } catch (error) {
        this.logger.warn('Lock renewal failed, continuing...', error);
      }
    };

    try {
      await callback(renew);
    } finally {
      active = false;
      clearInterval(interval);
      // Release lock
      await this.redis
        .eval(this.SCRIPTS.RELEASE, 1, CONFIG.LOCK.KEY, lockValue)
        .catch((error) => {
          this.logger.warn('Failed to release lock: ', error);
        });
    }
  }
}
