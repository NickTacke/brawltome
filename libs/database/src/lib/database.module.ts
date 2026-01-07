import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { GameDataCacheService } from './game-data-cache.service.js';
import { ClanLegendResolverService } from './clan-legend-resolver.service.js';

@Global()
@Module({
  providers: [PrismaService, GameDataCacheService, ClanLegendResolverService],
  exports: [PrismaService, GameDataCacheService, ClanLegendResolverService],
})
export class DatabaseModule {}
