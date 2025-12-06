import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { PlayerService } from './player.service';

@Controller('player')
export class PlayerController {
    constructor(private readonly playerService: PlayerService) {}

    @Get(':id')
    async getPlayer(@Param('id', ParseIntPipe) id: number) {
        const player = await this.playerService.getPlayer(id);
        if (!player) {
            throw new NotFoundException(`Player with ID ${id} not found`);
        }
        return player;
    }
}