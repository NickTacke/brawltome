import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BhApiClientService } from './bhapi-client.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [BhApiClientService],
  exports: [BhApiClientService],
})
export class BhApiClientModule {}