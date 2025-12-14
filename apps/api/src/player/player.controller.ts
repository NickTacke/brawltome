import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { PlayerService } from './player.service';

@Controller('player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Get('leaderboard/:page')
  async getLeaderboard(
    @Param('page', ParseIntPipe) page: number,
    @Query('region') region?: string,
    @Query('sort') sort?: 'rating' | 'wins' | 'games' | 'peakRating',
    @Query('limit', ParseIntPipe) limit?: number
  ) {
    return this.playerService.getLeaderboard(page, region, sort, limit);
  }

  @Get(':id')
  async getPlayer(@Param('id', ParseIntPipe) id: number) {
    const player = await this.playerService.getPlayer(id);
    if (!player) {
      throw new NotFoundException(`Player with ID ${id} not found`);
    }
    return player;
  }
}
