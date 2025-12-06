import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService ) {}

  @Get('player/:brawlhallaId')
  async getPlayer(@Param('brawlhallaId', ParseIntPipe) brawlhallaId: number) {
    const player = await this.appService.getPlayer(brawlhallaId);
    if (!player) {
      throw new NotFoundException(`Player with ID ${brawlhallaId} not found`);
    }
    return player;
  }

  @Get('search/:name')
  async searchPlayer(@Param('name') name: string) {
    return this.appService.searchPlayer(name);
  }

  @Get('rankings/:bracket/:region/:page')
  async getRankings(@Param('bracket') bracket: '1v1' | '2v2' | 'rotational', @Param('region') region: string, @Param('page') page: number) {
    return this.appService.getRankings(bracket, region, page);
  }
}