import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';

type LeaderboardSort = 'rating' | 'wins' | 'games' | 'peakRating' | 'rank';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('2v2/:page')
  async get2v2Leaderboard(
    @Param('page', ParseIntPipe) page: number,
    @Query('region') region?: string,
    @Query('sort') sort?: LeaderboardSort,
    @Query('limit', ParseIntPipe) limit?: number
  ) {
    return this.leaderboardService.get2v2Leaderboard(page, region, sort, limit);
  }
}
