import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import {
  PlayerRankedLegendDTO,
  PlayerRankedTeamDTO,
  PlayerStatsLegendDTO,
} from '@brawltome/shared-types';
import {
  createWeaponAggregator,
  parseDamage,
  REFRESH_RANKED_MIN_TOKENS,
  REFRESH_STATS_MIN_TOKENS,
} from '@brawltome/shared-utils';

const RATE_LIMIT_DELAY_MS = 1000 * 60 * 5; // 5 minutes

@Processor('refresh-queue')
export class RefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(RefreshProcessor.name);
  private legendWeaponsCache = new Map<
    number,
    { weaponOne: string; weaponTwo: string }
  >();
  private legendWeaponsCacheUpdatedAt = 0;

  constructor(
    private bhApiClient: BhApiClientService,
    private prisma: PrismaService
  ) {
    super();
  }

  private async getLegendWeaponsMap(): Promise<
    Map<number, { weaponOne: string; weaponTwo: string }>
  > {
    const ONE_HOUR_MS = 1000 * 60 * 60;
    const isFresh =
      this.legendWeaponsCache.size > 0 &&
      Date.now() - this.legendWeaponsCacheUpdatedAt < ONE_HOUR_MS;
    if (isFresh) return this.legendWeaponsCache;

    const legends = await this.prisma.legend.findMany({
      select: { legendId: true, weaponOne: true, weaponTwo: true },
    });
    this.legendWeaponsCache = new Map(
      legends.map((l) => [
        l.legendId,
        { weaponOne: l.weaponOne, weaponTwo: l.weaponTwo },
      ])
    );
    this.legendWeaponsCacheUpdatedAt = Date.now();
    return this.legendWeaponsCache;
  }

  async process(job: Job<{ id: number }>) {
    this.logger.debug(`Job started name=${job.name} id=${job.data.id}`);
    try {
      const { id } = job.data;
      const remainingTokens = await this.bhApiClient.getRemainingTokens();
      this.logger.debug(`Remaining tokens: ${remainingTokens}`);

      // Halt refreshing stats if we're on a low budget (more priority on ranked)
      if (
        remainingTokens < REFRESH_STATS_MIN_TOKENS &&
        job.name === 'refresh-stats'
      ) {
        this.logger.warn(
          `Delaying stats refresh for ${id} (Tokens: ${remainingTokens})`
        );
        await job.moveToDelayed(Date.now() + RATE_LIMIT_DELAY_MS, job.token);
        throw new DelayedError(
          'Rate-limited: insufficient tokens for stats refresh'
        );
      } else if (
        remainingTokens < REFRESH_RANKED_MIN_TOKENS &&
        job.name === 'refresh-ranked'
      ) {
        this.logger.warn(
          `Delaying ranked refresh for ${id} (Tokens: ${remainingTokens})`
        );
        await job.moveToDelayed(Date.now() + RATE_LIMIT_DELAY_MS, job.token);
        throw new DelayedError(
          'Rate-limited: insufficient tokens for ranked refresh'
        );
      }

      if (job.name === 'refresh-ranked') {
        const data = await this.bhApiClient.getPlayerRanked(id);

        // Ranked upsert
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.player.findUnique({
            where: { brawlhallaId: id },
            select: {
              name: true,
              brawlhallaId: true,
              tier: true,
              lastUpdated: true,
            },
          });

          // Only update name if it's not empty/whitespace
          const newName = data.name;
          const shouldUpdateName = newName && newName.trim().length > 0;

          const aliasUpdate =
            shouldUpdateName &&
            existing &&
            existing.name &&
            existing.name !== newName
              ? {
                  aliases: {
                    upsert: {
                      where: {
                        brawlhallaId_key: {
                          brawlhallaId: id,
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

          // Tier logic:
          // - We do NOT want refresh-ranked to downgrade Valhallan -> Diamond (tier accuracy should come from janitor rankings).
          // - Exception: if the player hasn't been leaderboard-updated in > 24h (likely not on leaderboard / season reset), allow the downgrade.
          const ONE_DAY_MS = 1000 * 60 * 60 * 24;
          const existingTier = existing?.tier ?? null;
          const lastLeaderboardUpdate = existing?.lastUpdated ?? null;
          const leaderboardStale =
            !lastLeaderboardUpdate ||
            Date.now() - lastLeaderboardUpdate.getTime() > ONE_DAY_MS;

          const nextTier =
            existingTier === 'Valhallan' &&
            data.tier === 'Diamond' &&
            !leaderboardStale
              ? 'Valhallan'
              : data.tier;

          await tx.player.update({
            where: { brawlhallaId: id },
            data: {
              ...(shouldUpdateName ? { name: newName } : {}),
              rating: data.rating,
              peakRating: data.peak_rating,
              tier: nextTier,
              games: data.games,
              wins: data.wins,
              ...aliasUpdate,
            },
          });

          await tx.playerRanked.upsert({
            where: { brawlhallaId: id },
            update: {
              globalRank: data.global_rank,
              regionRank: data.region_rank,
              lastUpdated: new Date(),
              legends: {
                deleteMany: {},
                create: this.mapLegends(data.legends),
              },
              teams: {
                deleteMany: {},
                create: this.mapTeams(data['2v2']),
              },
            },
            create: {
              brawlhallaId: id,
              globalRank: data.global_rank,
              regionRank: data.region_rank,
              lastUpdated: new Date(),
              legends: {
                create: this.mapLegends(data.legends),
              },
              teams: {
                create: this.mapTeams(data['2v2']),
              },
            },
          });
        });
      } else if (job.name === 'refresh-stats') {
        const data = await this.bhApiClient.getPlayerStats(id);
        const legendIdToWeapons = await this.getLegendWeaponsMap();

        await this.prisma.$transaction(async (tx) => {
          const statsLegends: PlayerStatsLegendDTO[] = (
            data.legends || []
          ).filter((l: PlayerStatsLegendDTO) => l.legend_id !== 0);
          const matchTimeTotal = statsLegends.reduce(
            (sum: number, l: PlayerStatsLegendDTO) => sum + (l.matchtime || 0),
            0
          );

          const weaponAgg = createWeaponAggregator();

          for (const l of statsLegends) {
            const weapons = legendIdToWeapons.get(l.legend_id);
            if (!weapons) continue;

            weaponAgg.add(
              weapons.weaponOne,
              l.timeheldweaponone || 0,
              parseDamage(l.damageweaponone),
              l.koweaponone || 0
            );
            weaponAgg.add(
              weapons.weaponTwo,
              l.timeheldweapontwo || 0,
              parseDamage(l.damageweapontwo),
              l.koweapontwo || 0
            );
          }

          const weaponStatsRows = Array.from(weaponAgg.values())
            .filter((w) => w.timeHeld > 0 || w.damage > 0 || w.KOs > 0)
            .map((w) => ({
              weapon: w.weapon,
              timeHeld: w.timeHeld,
              damage: String(w.damage),
              KOs: w.KOs,
            }));

          // Update main player name if Stats has a better name and current is empty/missing
          // Or simply trust Stats name if we want to be robust
          if (data.name && data.name.trim().length > 0) {
            const existing = await tx.player.findUnique({
              where: { brawlhallaId: id },
              select: { name: true },
            });

            // If current name is empty or missing, update it
            // Or if we want to enforce stats name as primary
            if (
              existing &&
              (!existing.name || existing.name.trim().length === 0)
            ) {
              await tx.player.update({
                where: { brawlhallaId: id },
                data: { name: data.name },
              });
            }
          }

          // If clan data is missing, ensure we clean up any existing clan record
          if (!data.clan) {
            await tx.playerClan.deleteMany({
              where: { brawlhallaId: id },
            });
          }

          await tx.playerStats.upsert({
            where: { brawlhallaId: id },
            update: {
              xp: data.xp,
              level: data.level,
              xpPercentage: data.xp_percentage,
              games: data.games,
              wins: data.wins,
              matchTimeTotal,
              damageBomb: data.damagebomb,
              damageMine: data.damagemine,
              damageSpikeball: data.damagespikeball,
              damageSidekick: data.damagesidekick,
              hitSnowball: data.hitsnowball,
              koBomb: data.kobomb,
              koMine: data.komine,
              koSpikeball: data.kospikeball,
              koSidekick: data.kosidekick,
              koSnowball: data.kosnowball,
              legends: {
                deleteMany: {},
                create: this.mapStatsLegends(data.legends),
              },
              weaponStats: {
                deleteMany: {},
                create: weaponStatsRows,
              },
              clan: data.clan
                ? {
                    upsert: {
                      update: {
                        clanName: data.clan.clan_name,
                        clanId: data.clan.clan_id,
                        clanXp: data.clan.clan_xp,
                        clanLifetimeXp: data.clan.clan_lifetime_xp,
                        personalXp: data.clan.personal_xp,
                      },
                      create: {
                        clanName: data.clan.clan_name,
                        clanId: data.clan.clan_id,
                        clanXp: data.clan.clan_xp,
                        clanLifetimeXp: data.clan.clan_lifetime_xp,
                        personalXp: data.clan.personal_xp,
                      },
                    },
                  }
                : undefined,
              lastUpdated: new Date(),
            },
            create: {
              brawlhallaId: id,
              xp: data.xp,
              level: data.level,
              xpPercentage: data.xp_percentage,
              games: data.games,
              wins: data.wins,
              matchTimeTotal,
              damageBomb: data.damagebomb,
              damageMine: data.damagemine,
              damageSpikeball: data.damagespikeball,
              damageSidekick: data.damagesidekick,
              hitSnowball: data.hitsnowball,
              koBomb: data.kobomb,
              koMine: data.komine,
              koSpikeball: data.kospikeball,
              koSidekick: data.kosidekick,
              koSnowball: data.kosnowball,
              legends: {
                create: this.mapStatsLegends(data.legends),
              },
              weaponStats: {
                create: weaponStatsRows,
              },
              clan: data.clan
                ? {
                    create: {
                      clanName: data.clan.clan_name,
                      clanId: data.clan.clan_id,
                      clanXp: data.clan.clan_xp,
                      clanLifetimeXp: data.clan.clan_lifetime_xp,
                      personalXp: data.clan.personal_xp,
                    },
                  }
                : undefined,
              lastUpdated: new Date(),
            },
          });
        });
      } else {
        this.logger.warn(`Unknown job name: ${job.name} for ${id}`);
        throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to process job ${job.name} for ${job.data.id}: ${message}`,
        stack
      );
      throw error;
    }
  }

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

  private mapStatsLegends(legends: PlayerStatsLegendDTO[]) {
    if (!legends) return [];
    return legends
      .filter((legend) => legend.legend_id !== 0)
      .map((legend) => ({
        legendId: legend.legend_id,
        legendNameKey: legend.legend_name_key,
        xp: legend.xp,
        level: legend.level,
        xpPercentage: legend.xp_percentage,
        games: legend.games,
        wins: legend.wins,
        matchTime: legend.matchtime,
        KOs: legend.kos,
        teamKOs: legend.teamkos,
        suicides: legend.suicides,
        falls: legend.falls,
        damageDealt: legend.damagedealt,
        damageTaken: legend.damagetaken,
        damageWeaponOne: legend.damageweaponone,
        damageWeaponTwo: legend.damageweapontwo,
        timeHeldWeaponOne: legend.timeheldweaponone,
        timeHeldWeaponTwo: legend.timeheldweapontwo,
        KOWeaponOne: legend.koweaponone,
        KOWeaponTwo: legend.koweapontwo,
        KOUnarmed: legend.kounarmed,
        KOThrownItem: legend.kothrownitem,
        KOGadgets: legend.kogadgets,
        damageUnarmed: legend.damageunarmed,
        damageThrownItem: legend.damagethrownitem,
        damageGadgets: legend.damagegadgets,
      }));
  }
}
