import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';
import { QueueModule } from '../queue/queue.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlayerModule } from '../player/player.module';
import { SearchModule } from '../search/search.module';
import { JanitorModule } from '../janitor/janitor.module';
import { ClanModule } from '../clan/clan.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env']
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    BhApiClientModule,
    QueueModule,
    PlayerModule,
    SearchModule,
    JanitorModule,
    ClanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}