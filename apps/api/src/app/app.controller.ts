import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('player/:brawlhallaId')
  async getPlayer(@Param('brawlhallaId', ParseIntPipe) brawlhallaId: number) {
    const player = await this.appService.getPlayer(brawlhallaId);
    if (!player) {
      throw new NotFoundException(`Player with ID ${brawlhallaId} not found`);
    }
    return player;
  }
}