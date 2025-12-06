import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from './player.service';
import { DatabaseModule } from '@brawltome/database';
import { QueueModule } from '../queue/queue.module';

@Module({
    imports: [DatabaseModule, QueueModule],
    controllers: [PlayerController],
    providers: [PlayerService],
})
export class PlayerModule {}