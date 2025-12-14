import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ClanService } from './clan.service';

@Controller('clan')
export class ClanController {
  constructor(private readonly clanService: ClanService) {}

  @Get(':id')
  getClan(@Param('id', ParseIntPipe) id: number) {
    return this.clanService.getClan(id);
  }
}
