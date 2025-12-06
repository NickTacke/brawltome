import { Injectable } from '@nestjs/common';
import { Player, PrismaService } from '@brawltome/database';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlayer(brawlhallaId: number): Promise<Player | null> {
    return await this.prisma.player.findUnique({
      where: { brawlhallaId },
    });
  }
}