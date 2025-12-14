import { Module } from '@nestjs/common';
import { ClanController } from './clan.controller';
import { ClanService } from './clan.service';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';

@Module({
  imports: [DatabaseModule, BhApiClientModule],
  controllers: [ClanController],
  providers: [ClanService],
})
export class ClanModule {}
