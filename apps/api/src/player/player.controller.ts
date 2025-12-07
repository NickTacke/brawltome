import { Controller, Get, Param, ParseIntPipe, NotFoundException, Query } from '@nestjs/common';
import { PlayerService } from './player.service';

@Controller('player')
export class PlayerController {
    constructor(private readonly playerService: PlayerService) {}

    @Get('leaderboard/:page')
    async getLeaderboard(
        @Param('page', ParseIntPipe) page: number,
        @Query('region') region?: string,
        @Query('limit', ParseIntPipe) limit?: number
    ) {
        return this.playerService.getLeaderboard(page, region, limit);
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