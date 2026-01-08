import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  REFRESH_QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
} from '@brawltome/shared-utils';

@Module({
  imports: [
    BullModule.registerQueue({
      name: REFRESH_QUEUE_NAME,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  ],
  providers: [],
  exports: [BullModule],
})
export class QueueModule {}
