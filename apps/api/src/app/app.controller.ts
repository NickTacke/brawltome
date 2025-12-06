import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService ) {}

  @Get('rankings/:bracket/:region/:page')
  async getRankings(@Param('bracket') bracket: '1v1' | '2v2' | 'rotational', @Param('region') region: string, @Param('page') page: number) {
    return this.appService.getRankings(bracket, region, page);
  } 
}