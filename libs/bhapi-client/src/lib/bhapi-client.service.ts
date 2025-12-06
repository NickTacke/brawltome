import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlayerDTO } from '@brawltome/shared-types';
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class BhApiClientService implements OnModuleInit {
    private limiter: Bottleneck;
    private http: AxiosInstance;
    private readonly logger = new Logger(BhApiClientService.name);

    constructor(private config: ConfigService) {
        const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
        // Log the URL (masked) to verify we are getting it
        this.logger.log(`Using Redis URL: ${redisUrl.replace(/:\/\/.*@/, '://***@')}`);

        const apiKey = this.config.getOrThrow<string>('BRAWLHALLA_API_KEY');

        // Initialize HTTP client
        this.http = axios.create({
            baseURL: 'https://api.brawlhalla.com',
            params: { api_key: apiKey },
        });

        // Initialize Redis connection manually to ensure URL is used correctly
        const connection = new Bottleneck.IORedisConnection({
            client: new Redis(redisUrl),
        });

        // Initialize rate limiter
        this.limiter = new Bottleneck({
            // Cluster settings
            id: 'bhapi-limiter',
            datastore: 'redis',
            connection,
            clearDatastore: false,

            // Traffic settings
            minTime: 100,
            maxConcurrent: 1,

            // Economy settings
            reservoir: 180,
            reservoirRefreshAmount: 180,
            reservoirRefreshInterval: 15 * 60 * 1000,
        });

        // Debug logging
        this.limiter.on('error', (err) => this.logger.error('⚠️ Bottleneck error', err));
        this.limiter.on('depleted', () => this.logger.warn('⚠️ API Quota Depleted!'));
    }

    onModuleInit() {
        this.logger.log('Brawlhalla Gatekeeper Initialized 🛡️');
    }

    // -- Public Methods --

    async getRemainingTokens(): Promise<number> {
        const reservoir = await this.limiter.currentReservoir();
        return reservoir || 0;
    }

    async getPlayerStats(brawlhallaId: number): Promise<PlayerDTO> {
        return this.limiter.schedule(() => this.performRequest(`/player/${brawlhallaId}/stats`));
    }

    async getRankings(bracket: '1v1' | '2v2' | 'rotational', region: string, page: number, name: string | null = null): Promise<PlayerDTO[]> {
        const params = name ? { name } : {};
        return this.limiter.schedule(() => this.performRequest(`/rankings/${bracket}/${region}/${page}`, params));
    }

    async searchPlayer(name: string): Promise<PlayerDTO[]> {
        return this.getRankings('1v1', 'all', 1, name);
    }

    // -- Private Methods --

    private async performRequest(endpoint: string, params: Record<string, unknown> = {}) {
        try {
            const response = await this.http.get(endpoint, { params });
            return response.data;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            if (error.status === 429) {
                this.logger.error(`ALERT! Rate Limit Exceeded Unexpectedly!`);
            }
            throw error;
        }
    }
}   