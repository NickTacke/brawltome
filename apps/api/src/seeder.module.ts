import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@brawltome/database';
import { BhApiClientModule } from '@brawltome/bhapi-client';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env']
    }),
    DatabaseModule,
    BhApiClientModule,
  ],
})
export class SeederModule {}

