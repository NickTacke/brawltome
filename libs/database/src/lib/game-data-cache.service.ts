import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { normalizeWeaponName } from '@brawltome/shared-utils';

@Injectable()
export class GameDataCacheService implements OnModuleInit {
  private readonly logger = new Logger(GameDataCacheService.name);

  private legendIdToBioName = new Map<number, string>();
  private legendNameKeyToBioName = new Map<string, string>();
  private legendIdToNameKey = new Map<number, string>();
  private legendIdToWeapons = new Map<
    number,
    { weaponOne: string; weaponTwo: string }
  >();
  private blacklistedIds = new Set<number>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await Promise.all([this.loadLegends(), this.loadBlacklist()]);
  }

  private async loadLegends() {
    try {
      const legends = await this.prisma.legend.findMany({
        select: {
          legendId: true,
          legendNameKey: true,
          bioName: true,
          weaponOne: true,
          weaponTwo: true,
        },
      });

      this.legendIdToBioName = new Map(
        legends.map((l) => [l.legendId, l.bioName])
      );
      this.legendNameKeyToBioName = new Map(
        legends.map((l) => [l.legendNameKey, l.bioName])
      );
      this.legendIdToNameKey = new Map(
        legends.map((l) => [l.legendId, l.legendNameKey])
      );
      this.legendIdToWeapons = new Map(
        legends.map((l) => [
          l.legendId,
          {
            weaponOne: normalizeWeaponName(l.weaponOne),
            weaponTwo: normalizeWeaponName(l.weaponTwo),
          },
        ])
      );

      this.logger.log(`Loaded ${legends.length} legends into cache`);
    } catch (error) {
      this.logger.error('Failed to load legend cache', error);
    }
  }

  private async loadBlacklist() {
    try {
      const blacklist = await this.prisma.blacklist.findMany({
        select: { brawlhallaId: true },
      });
      this.blacklistedIds = new Set(blacklist.map((b) => b.brawlhallaId));
      this.logger.log(`Loaded ${this.blacklistedIds.size} blacklisted IDs`);
    } catch (error) {
      this.logger.error('Failed to load blacklist cache', error);
    }
  }

  async refresh() {
    await Promise.all([this.loadLegends(), this.loadBlacklist()]);
  }

  getBioNameById(legendId: number): string | undefined {
    return this.legendIdToBioName.get(legendId);
  }

  getBioNameByKey(legendNameKey: string): string | undefined {
    return this.legendNameKeyToBioName.get(legendNameKey);
  }

  getNameKeyById(legendId: number): string | undefined {
    return this.legendIdToNameKey.get(legendId);
  }

  getWeaponsById(
    legendId: number
  ): { weaponOne: string; weaponTwo: string } | undefined {
    return this.legendIdToWeapons.get(legendId);
  }

  isBlacklisted(brawlhallaId: number): boolean {
    return this.blacklistedIds.has(brawlhallaId);
  }

  getBlacklistedIds(): Set<number> {
    return this.blacklistedIds;
  }

  getLegendCount(): number {
    return this.legendIdToBioName.size;
  }
}
