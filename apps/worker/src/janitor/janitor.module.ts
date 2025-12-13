import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { QueueModule } from '../queue/queue.module';
import { JanitorService } from './janitor.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, BhApiClientModule, QueueModule, RedisModule],
  providers: [JanitorService],
})
export class JanitorModule {}


