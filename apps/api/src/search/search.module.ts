import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [DatabaseModule, BhApiClientModule, QueueModule],
    controllers: [SearchController],
    providers: [SearchService],
})
export class SearchModule {}