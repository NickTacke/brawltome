import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';

import {
  PlayerRankedLegendDTO,
  PlayerRankedTeamDTO,
  PlayerStatsLegendDTO,
} from '@brawltome/shared-types';
import { createWeaponAggregator, parseDamage } from '@brawltome/shared-utils';

@Processor('refresh-queue', {
  concurrency: 10,
})
export class RefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(RefreshProcessor.name);

  private legendWeaponsCache = new Map<
    number,
    { weaponOne: string; weaponTwo: string }
  >();

  private async getLegendWeaponsMap(): Promise<
    Map<number, { weaponOne: string; weaponTwo: string }>
  > {
    if (this.legendWeaponsCache.size > 0) return this.legendWeaponsCache;

    const legends = await this.prisma.legend.findMany({
      select: { legendId: true, weaponOne: true, weaponTwo: true },
    });

    this.legendWeaponsCache = new Map(
      legends.map((l) => [
        l.legendId,
        {
          weaponOne:
            l.weaponOne === 'Fists'
              ? 'Gauntlets'
              : l.weaponOne === 'Pistol'
              ? 'Blasters'
              : l.weaponOne === 'Katar'
              ? 'Katars'
              : l.weaponOne,
          weaponTwo:
            l.weaponTwo === 'Fists'
              ? 'Gauntlets'
              : l.weaponTwo === 'Pistol'
              ? 'Blasters'
              : l.weaponTwo === 'Katar'
              ? 'Katars'
              : l.weaponTwo,
        },
      ])
    );
    return this.legendWeaponsCache;
  }

  constructor(
    private bhApiClient: BhApiClientService,
    private prisma: PrismaService
  ) {
    super();
  }

  async process(job: Job<{ id: number }>) {
    const { id } = job.data;
    this.logger.log(
      `Processing ${job.name} for ${
        job.name === 'refresh-clan' ? 'clan' : 'player'
      } ${id}`
    );

    switch (job.name) {
      case 'refresh-ranked':
        await this.processRefreshRanked(id);
        break;
      case 'refresh-stats':
        await this.processRefreshStats(id);
        break;
      case 'refresh-clan':
        await this.processRefreshClan(id);
        break;
      default:
        throw new UnrecoverableError(`Unknown job name: ${job.name}`);
    }
  }

  private async processRefreshRanked(id: number) {
    const data = await this.bhApiClient.getPlayerRanked(id);

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

      await tx.player.update({
        where: { brawlhallaId: id },
        data: {
          ...(shouldUpdateName ? { name: newName } : {}),
          rating: data.rating,
          peakRating: data.peak_rating,
          tier: data.tier,
          games: data.games,
          wins: data.wins,
          ...aliasUpdate,
        },
      });

      await tx.playerRanked.upsert({
        where: { brawlhallaId: id },
        update: {
          legends: {
            deleteMany: {},
            create: this.mapLegends(data.legends),
          },
          teams: {
            deleteMany: {},
            create: this.mapTeams(data['2v2']),
          },
          lastUpdated: new Date(),
        },
        create: {
          brawlhallaId: id,
          legends: {
            create: this.mapLegends(data.legends),
          },
          teams: {
            create: this.mapTeams(data['2v2']),
          },
          lastUpdated: new Date(),
        },
      });
    });
  }

  private async processRefreshStats(id: number) {
    const data = await this.bhApiClient.getPlayerStats(id);
    const legendIdToWeapons = await this.getLegendWeaponsMap();

    const statsLegends: PlayerStatsLegendDTO[] = data.legends || [];
    const totalPlaytime = statsLegends.reduce(
      (sum, l) => sum + (l.matchtime || 0),
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

    await this.prisma.$transaction(async (tx) => {
      if (data.name && data.name.trim().length > 0) {
        const existing = await tx.player.findUnique({
          where: { brawlhallaId: id },
          select: { name: true },
        });
        if (existing && (!existing.name || existing.name.trim().length === 0)) {
          await tx.player.update({
            where: { brawlhallaId: id },
            data: { name: data.name },
          });
        }
      }

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
          matchTimeTotal: totalPlaytime,
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
            create: this.mapStatsLegends(statsLegends),
          },
          weaponStats: {
            deleteMany: {},
            create: weaponStatsRows,
          },
          clan: data.clan
            ? {
                upsert: {
                  where: { brawlhallaId: id },
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
          matchTimeTotal: totalPlaytime,
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
            create: this.mapStatsLegends(statsLegends),
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
  }

  private async processRefreshClan(id: number) {
    const clanData = await this.bhApiClient.getClan(id);

    const memberIds = clanData.clan.map((m) => m.brawlhalla_id);

    const bestLegends = await this.prisma.playerRankedLegend.findMany({
      where: { brawlhallaId: { in: memberIds } },
      orderBy: { rating: 'desc' },
      distinct: ['brawlhallaId'],
      select: { brawlhallaId: true, legendId: true },
    });

    const legendIds = bestLegends.map((bl) => bl.legendId);
    const legends = await this.prisma.legend.findMany({
      where: { legendId: { in: legendIds } },
      select: { legendId: true, legendNameKey: true },
    });

    const legendKeyMap = new Map(
      legends.map((l) => [l.legendId, l.legendNameKey])
    );
    const playerLegendMap = new Map<number, string>();

    for (const bl of bestLegends) {
      const legendNameKey = legendKeyMap.get(bl.legendId);
      if (legendNameKey) {
        playerLegendMap.set(bl.brawlhallaId, legendNameKey);
      }
    }

    const missingRankedIds = memberIds.filter(
      (pid) => !playerLegendMap.has(pid)
    );
    if (missingRankedIds.length > 0) {
      const statsFallback = await this.prisma.playerStatsLegend.findMany({
        where: { brawlhallaId: { in: missingRankedIds } },
        orderBy: { xp: 'desc' },
        distinct: ['brawlhallaId'],
        select: { brawlhallaId: true, legendNameKey: true },
      });
      for (const row of statsFallback) {
        if (row.legendNameKey) {
          playerLegendMap.set(row.brawlhallaId, row.legendNameKey);
        }
      }
    }

    await this.prisma.clan.upsert({
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
    });

    this.logger.log(
      `Refreshed clan ${id} with ${clanData.clan.length} members`
    );
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
