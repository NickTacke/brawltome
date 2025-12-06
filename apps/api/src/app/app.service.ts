import { Injectable } from '@nestjs/common';
import { Player, PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PlayerDTO } from '@brawltome/shared-types';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService, private readonly bhApiClient: BhApiClientService) {}

  async getPlayer(brawlhallaId: number): Promise<Player | null> {
    return await this.prisma.player.findUnique({
      where: { brawlhallaId: brawlhallaId },
    });
  }

  async getRankings(bracket: '1v1' | '2v2' | 'rotational', region: string, page: number): Promise<PlayerDTO[]> {
    return await this.bhApiClient.getRankings(bracket, region, page);
  }
}