import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Optional,
} from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardSort, SortOrder } from '@brawltome/shared-types';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('1v1/:page')
  async get1v1Leaderboard(
    @Param('page', ParseIntPipe) page: number,
    @Query('region') region?: string,
    @Query('sort') sort?: LeaderboardSort,
    @Query('order') order?: SortOrder,
    @Query('limit') @Optional() limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined;
    return this.leaderboardService.get1v1Leaderboard(
      page,
      region,
      sort,
      order,
      parsedLimit,
    );
  }

  @Get('2v2/:page')
  async get2v2Leaderboard(
    @Param('page', ParseIntPipe) page: number,
    @Query('region') region?: string,
    @Query('sort') sort?: LeaderboardSort,
    @Query('order') order?: SortOrder,
    @Query('limit') @Optional() limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined;
    return this.leaderboardService.get2v2Leaderboard(
      page,
      region,
      sort,
      order,
      parsedLimit,
    );
  }
}
