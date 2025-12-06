import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RefreshProcessor } from './refresh.processor';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { DatabaseModule } from '@brawltome/database';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'refresh-queue',
            defaultJobOptions: {
                removeOnComplete: 100,
                removeOnFail: 500,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
            }
        }),
        BhApiClientModule,
        DatabaseModule,
    ],
    providers: [RefreshProcessor],
    exports: [BullModule],
})
export class QueueModule {}