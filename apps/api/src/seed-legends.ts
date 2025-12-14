import { NestFactory } from '@nestjs/core';
import { SeederModule } from './seeder.module';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('LegendSeeder');
  const app = await NestFactory.createApplicationContext(SeederModule);

  const bhApiClient = app.get(BhApiClientService);
  const prisma = app.get(PrismaService);

  logger.log('Starting legend seeder');

  try {
    // 1. Fetch all legends summary
    logger.log('Fetching legends summary');
    const allLegends = await bhApiClient.getAllLegends();

    logger.log(
      `Found ${allLegends.length} legends. Starting detailed fetch...`
    );

    // 2. Iterate and fetch details for each
    for (const summary of allLegends) {
      try {
        logger.log(
          `Fetching details for ${summary.bio_name} (ID: ${summary.legend_id})...`
        );
        const details = await bhApiClient.getLegend(summary.legend_id);

        // 3. Upsert into database
        await prisma.legend.upsert({
          where: { legendId: details.legend_id },
          update: {
            legendNameKey: details.legend_name_key,
            bioName: details.bio_name,
            bioAka: details.bio_aka,
            bioQuote: details.bio_quote,
            bioQuoteAboutAttrib: details.bio_quote_about_attrib,
            bioQuoteFrom: details.bio_quote_from,
            bioQuoteFromAttrib: details.bio_quote_from_attrib,
            bioText: details.bio_text,
            botName: details.bot_name,
            weaponOne: details.weapon_one,
            weaponTwo: details.weapon_two,
            strength: details.strength,
            dexterity: details.dexterity,
            defense: details.defense,
            speed: details.speed,
          },
          create: {
            legendId: details.legend_id,
            legendNameKey: details.legend_name_key,
            bioName: details.bio_name,
            bioAka: details.bio_aka,
            bioQuote: details.bio_quote,
            bioQuoteAboutAttrib: details.bio_quote_about_attrib,
            bioQuoteFrom: details.bio_quote_from,
            bioQuoteFromAttrib: details.bio_quote_from_attrib,
            bioText: details.bio_text,
            botName: details.bot_name,
            weaponOne: details.weapon_one,
            weaponTwo: details.weapon_two,
            strength: details.strength,
            dexterity: details.dexterity,
            defense: details.defense,
            speed: details.speed,
          },
        });

        // Add a small delay to be nice to the API rate limiter
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        logger.error(`Failed to process legend ${summary.bio_name}:`, err);
      }
    }

    logger.log('Legend seeding complete');
  } catch (error) {
    logger.error('Global error during legend seeding', error);
  } finally {
    await app.close();
  }
}

bootstrap();
