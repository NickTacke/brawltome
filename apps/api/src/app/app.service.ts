import { Injectable } from '@nestjs/common';
import { Player, PrismaService } from '@brawltome/database';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PlayerDTO, Ranked2v2TeamDTO } from '@brawltome/shared-types';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bhApiClient: BhApiClientService
  ) {}

  async getPlayer(brawlhallaId: number): Promise<Player | null> {
    return await this.prisma.player.findUnique({
      where: { brawlhallaId: brawlhallaId },
    });
  }

  async getRankings(
    bracket: '1v1' | '2v2' | 'rotational',
    region: string,
    page: number
  ): Promise<PlayerDTO[] | Ranked2v2TeamDTO[]> {
    if (bracket === '2v2') {
      return await this.bhApiClient.getRankings('2v2', region, page);
    }
    return await this.bhApiClient.getRankings(bracket, region, page);
  }

  async getServerStatus() {
    const tokens = await this.bhApiClient.getRemainingTokens();
    return { tokens };
  }
}
