import { Injectable } from '@nestjs/common';
import { Player, PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService, private readonly bhApiClient: BhApiClientService) {}

  async getPlayer(brawlhallaId: number): Promise<Player | null> {
    return await this.prisma.player.findUnique({
      where: { brawlhallaId },
    });
  }

  async searchPlayer(name: string): Promise<Player | null> {
    const results = await this.bhApiClient.searchPlayer(name);
    return results;
  }

  async getRankings(bracket: '1v1' | '2v2' | 'rotational', region: string, page: number): Promise<Player | null> {
    return await this.bhApiClient.getRankings(bracket, region, page);
  }
}