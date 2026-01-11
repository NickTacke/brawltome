import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS so the web app (running on a different port) can call this API
  const frontendUrl = process.env.FRONTEND_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !frontendUrl) {
    throw new Error(
      'FRONTEND_URL environment variable must be set in production',
    );
  }

  app.enableCors({
    origin: frontendUrl || 'http://localhost:3000',
  });

  const port = process.env.PORT || 8080;
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
