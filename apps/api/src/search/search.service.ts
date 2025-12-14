import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PlayerRankedLegendDTO,
  PlayerRankedTeamDTO,
} from '@brawltome/shared-types';
import { SEARCH_API_MIN_TOKENS } from '@brawltome/shared-utils';
import { matchesNameOrBasePrefix, sanitizeSearchQuery } from './search.utils';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private legendCache: Map<number, string> = new Map();
  private legendIdToKeyCache: Map<number, string> = new Map();

  constructor(
    private prisma: PrismaService,
    private bhApiClient: BhApiClientService,
    @InjectQueue('refresh-queue') private refreshQueue: Queue
  ) {}

  async onModuleInit() {
    await this.refreshLegendCache();
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

  // Local Search
  async searchLocal(query: string) {
    // Check if query is a Brawlhalla ID (numeric)
    if (/^\d+$/.test(query)) {
      const id = parseInt(query, 10);
      const players = await this.searchById(id);
      const clan = await this.prisma.clan.findUnique({
        where: { clanId: id },
        select: { clanId: true, clanName: true, clanXp: true },
      });
      return {
        players,
        clans: clan ? [clan] : [],
      };
    }

    // Sanitize the query (preserve '|') and normalize pipe spacing for better matching against stored names
    const sanitized = sanitizeSearchQuery(query);

    // Return empty results if query is too short
    if (sanitized.length < 2) return { players: [], clans: [] };

    this.logger.debug(`Local search query="${sanitized}"`);

    const [players, clans] = await Promise.all([
      this.prisma.player.findMany({
        where: {
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
        // Pull more candidates, then filter by prefix rules in-memory.
        take: 50,
        orderBy: {
          rating: 'desc',
        },
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
          // Count members if possible, or just return basic info
          _count: {
            select: { members: true },
          },
        },
      }),
    ]);

    // Enforce prefix-only matching (with optional post-'|' base-name matching) and attach alias match metadata.
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

    // Enrich with Legend Names
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

      // Don't leak nested stats payload to the search endpoint response
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

  private async searchById(id: number) {
    this.logger.debug(`Search by ID: ${id}`);

    // 1. Try to find in DB
    const player = await this.prisma.player.findUnique({
      where: { brawlhallaId: id },
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
    });

    if (player) {
      this.logger.debug(`Found player ${id} locally; queueing refresh`);
      await this.refreshQueue.add('refresh-ranked', { id });
      await this.refreshQueue.add('refresh-stats', { id });

      const rankedBestLegendId =
        typeof player.bestLegend === 'number' && player.bestLegend > 0
          ? player.bestLegend
          : 0;
      const statsBestLegend = player.stats?.legends?.[0] ?? null;
      const fallbackLegendId = statsBestLegend?.legendId ?? 0;

      const legendIdForAvatar = rankedBestLegendId || fallbackLegendId || 0;
      const legendNameKeyForAvatar =
        rankedBestLegendId && rankedBestLegendId > 0
          ? this.legendIdToKeyCache.get(rankedBestLegendId) ?? null
          : statsBestLegend?.legendNameKey ?? null;
      const legendNameForAvatar =
        legendIdForAvatar && legendIdForAvatar > 0
          ? this.legendCache.get(legendIdForAvatar) ?? null
          : null;

      return [
        {
          // Don't leak nested stats payload to the search endpoint response
          ...(() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { stats, ...rest } = player;
            return rest;
          })(),
          bestLegendName: legendNameForAvatar,
          bestLegendNameKey: legendNameKeyForAvatar,
        },
      ];
    }

    // Check the remaining budget before fetching from API
    const tokens = await this.bhApiClient.getRemainingTokens();
    if (tokens < SEARCH_API_MIN_TOKENS) {
      this.logger.warn(
        `Search by ID ${id} blocked due to low tokens (${tokens})`
      );
      throw new HttpException(
        'Server busy. Cannot fetch new player data right now.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // 2. If not found, fetch from API
    this.logger.log(`Player ${id} not found locally; fetching from API`);
    try {
      // Priority: Stats first (for name/existence), then Ranked
      let name = '';
      let region = 'UNKNOWN';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let statsData: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rankedData: any = {};

      try {
        statsData = await this.bhApiClient.getPlayerStats(id);
        name = statsData?.name || '';
      } catch (e) {
        // Stats might fail for various reasons (404 etc), but it's our primary source for "existence"
        this.logger.warn(`Failed to fetch stats for ${id}: ${e}`);
      }

      // If we didn't find a name in stats, we can't create the player reliably
      if (!name) {
        this.logger.warn(`Could not find name for player ${id} in stats.`);
        return [];
      }

      // Try fetching ranked data to enrich
      try {
        rankedData = await this.bhApiClient.getPlayerRanked(id);
        region = rankedData.region || 'UNKNOWN';
      } catch (e) {
        this.logger.warn(
          `Failed to fetch ranked data for ${id}, using default values. ${e}`
        );
      }

      // Save to DB
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
              globalRank: rankedData.global_rank || 0,
              regionRank: rankedData.region_rank || 0,
              lastUpdated: new Date(),
              legends: {
                deleteMany: {},
                create: this.mapLegends(rankedData.legends),
              },
              teams: {
                deleteMany: {},
                create: this.mapTeams(rankedData['2v2']),
              },
            },
            create: {
              brawlhallaId: id,
              globalRank: rankedData.global_rank || 0,
              regionRank: rankedData.region_rank || 0,
              lastUpdated: new Date(),
              legends: {
                create: this.mapLegends(rankedData.legends),
              },
              teams: {
                create: this.mapTeams(rankedData['2v2']),
              },
            },
          });
        }
      });

      // Queue full refreshes
      await this.refreshQueue.add('refresh-stats', { id });
      if (rankedData.legends) {
        // We already have ranked data, but queuing it ensures consistency with our refresh logic
        // or we can skip it since we just upserted it.
        // Let's queue it to be safe and consistent with background workers
        await this.refreshQueue.add('refresh-ranked', { id });
      }

      return [
        {
          brawlhallaId: id,
          name: name,
          region: region,
          rating: rankedData.rating || 0,
          tier: rankedData.tier || 'Unranked',
          games: rankedData.games || 0,
          wins: rankedData.wins || 0,
          bestLegend: null,
          bestLegendName: (() => {
            const legends = (statsData?.legends || [])
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((l: any) => (l?.legend_id ?? 0) !== 0);
            if (legends.length === 0) return null;

            const best = legends.sort(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (a: any, b: any) => (b?.xp ?? 0) - (a?.xp ?? 0)
            )[0];
            const legendId = best?.legend_id ?? 0;
            return legendId ? this.legendCache.get(legendId) ?? null : null;
          })(),
          bestLegendNameKey: (() => {
            const legends = (statsData?.legends || [])
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((l: any) => (l?.legend_id ?? 0) !== 0);
            if (legends.length === 0) return null;

            const best = legends.sort(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (a: any, b: any) => (b?.xp ?? 0) - (a?.xp ?? 0)
            )[0];
            return best?.legend_name_key ?? null;
          })(),
        },
      ];
    } catch (error) {
      this.logger.warn(`Failed to find player ${id} via API: ${error}`);
      return [];
    }
  }

  // Helper methods
  private mapLegends(legends: PlayerRankedLegendDTO[]) {
    if (!legends) return [];
    return legends.map((legend) => ({
      legendId: legend.legend_id,
      legendNameKey: legend.legend_name_key,
      rating: legend.rating,
      peakRating: legend.peak_rating,
      tier: legend.tier,
      wins: legend.wins,
      games: legend.games,
    }));
  }

  private mapTeams(teams: PlayerRankedTeamDTO[]) {
    if (!teams) return [];

    // Deduplicate teams based on ID pairs
    const uniqueTeams = new Map<string, PlayerRankedTeamDTO>();
    for (const team of teams) {
      const key = `${team.brawlhalla_id_one}-${team.brawlhalla_id_two}`;
      if (!uniqueTeams.has(key)) {
        uniqueTeams.set(key, team);
      }
    }

    return Array.from(uniqueTeams.values()).map((team) => {
      return {
        brawlhallaIdOne: team.brawlhalla_id_one,
        brawlhallaIdTwo: team.brawlhalla_id_two,
        teamName: team.teamname,
        rating: team.rating,
        peakRating: team.peak_rating,
        tier: team.tier,
        wins: team.wins,
        games: team.games,
      };
    });
  }
}
