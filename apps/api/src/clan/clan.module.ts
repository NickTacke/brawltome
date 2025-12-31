import { Module } from '@nestjs/common';
import { ClanController } from './clan.controller';
import { ClanService } from './clan.service';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [DatabaseModule, BhApiClientModule, QueueModule],
  controllers: [ClanController],
  providers: [ClanService],
})
export class ClanModule {}
