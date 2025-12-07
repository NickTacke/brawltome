import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit() {
    console.log('Using DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));
    try {
        await this.$connect();
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }
  } 

  async onModuleDestroy() {
    await this.$disconnect();
  }
}