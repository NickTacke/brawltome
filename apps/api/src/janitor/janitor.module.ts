import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JanitorService } from './janitor.service';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        DatabaseModule,
        BhApiClientModule,
        QueueModule
    ],
    providers: [JanitorService],
})
export class JanitorModule {}
