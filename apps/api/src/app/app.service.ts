import { Player } from '@brawltome/database';
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async getPlayer(brawlhallaId: number): Promise<Player> {
    return await this.prisma.player.findMany({
    }) ?? null;
  }
}
