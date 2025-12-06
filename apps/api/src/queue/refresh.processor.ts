import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BhApiClientService } from '@brawltome/bhapi-client';
import { PrismaService } from '@brawltome/database';

const MIN_TOKENS_FOR_REFRESH = 20;

@Processor('refresh-queue')
export class RefreshProcessor extends WorkerHost {
    private readonly logger = new Logger(RefreshProcessor.name);

    constructor(
        private bhApiClient: BhApiClientService,
        private prisma: PrismaService,
    ) {
        super();
    }

    async process(job: Job<{ id: number }>) {
        const { id } = job.data;

        // Check the "economy"
        const remainingTokens = await this.bhApiClient.getRemainingTokens();
        
        // Wait with refreshing if we're on a low budget
        if (remainingTokens < MIN_TOKENS_FOR_REFRESH) {
            this.logger.warn(`Skipping refresh for ${id} (Tokens: ${remainingTokens})`);
            return;
        }

        // Fetch fresh stats
        try {
            const stats = await this.bhApiClient.getPlayerStats(id);
            this.logger.log(`Refreshing player ${id} with stats:`, stats);
            
            // TODO: Update PlayerStats
            
        } catch (error) {
            this.logger.error(`Error refreshing player ${id}:`, error);
            return;
        }
    }
}