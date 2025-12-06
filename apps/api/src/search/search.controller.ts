import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
    constructor(private readonly searchService: SearchService) {}

    @Get('local')
    async searchLocal(@Query('q') query: string) {
        if (!query || query.length < 3) {
            throw new BadRequestException('Query must be at least 3 characters long');
        }
        return this.searchService.searchLocal(query);
    }

    @Get('global')
    async searchGlobal(@Query('q') query: string) {
        if (!query || query.length < 3) {
            throw new BadRequestException('Query must be at least 3 characters long');
        }
        return this.searchService.searchGlobal(query);
    }
}