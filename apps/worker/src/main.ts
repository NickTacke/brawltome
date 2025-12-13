import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // Worker does not expose HTTP; it runs cron + BullMQ processors.
  await NestFactory.createApplicationContext(AppModule);
  Logger.log('👷 Worker application context started');
}

void bootstrap();