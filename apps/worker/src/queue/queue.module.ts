import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { DatabaseModule } from '@brawltome/database';
import {
  REFRESH_QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
} from '@brawltome/shared-utils';
import { RefreshProcessor } from './refresh.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: REFRESH_QUEUE_NAME,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    BhApiClientModule,
    DatabaseModule,
  ],
  providers: [RefreshProcessor],
  exports: [BullModule],
})
export class QueueModule {}
