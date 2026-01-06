import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { GameDataCacheService } from './game-data-cache.service.js';

@Global()
@Module({
  providers: [PrismaService, GameDataCacheService],
  exports: [PrismaService, GameDataCacheService],
})
export class DatabaseModule {}
