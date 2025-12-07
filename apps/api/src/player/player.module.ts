import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';
import { PlayerService } from './player.service';
import { DatabaseModule } from '@brawltome/database';
import { QueueModule } from '../queue/queue.module';
import { BhApiClientModule } from '@brawltome/bhapi-client';

@Module({
    imports: [DatabaseModule, QueueModule, BhApiClientModule],
    controllers: [PlayerController],
    providers: [PlayerService],
})
export class PlayerModule {}