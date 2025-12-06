import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import axios, { AxiosInstance } from 'axios';
import Redis from 'ioredis';

@Injectable()
export class BhApiClientService implements OnModuleInit {
    private limiter: Bottleneck;
    private http: AxiosInstance;
    private readonly logger = new Logger(BhApiClientService.name);

    constructor(private config: ConfigService) {
        const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
        const apiKey = this.config.getOrThrow<string>('BRAWLHALLA_API_KEY');

        // Initialize HTTP client
        this.http = axios.create({
            baseURL: 'https://api.brawlhalla.com',
            params: { api_key: apiKey },
        });

        // Initialize Redis connection
        const redisConnection = new Redis(redisUrl);

        // Initialize rate limiter
        this.limiter = new Bottleneck({
            // Cluster settings
            id: 'bhapi-limiter',
            datastore: "ioredis",
            clearDatastore: false,
            clientOptions: {
                client: redisConnection
            },

            // Traffic settings
            minTime: 100,
            maxConcurrent: 1,

            // Economy settings
            reservoir: 180,
            reservoirRefreshAmount: 180,
            reservoirRefreshInterval: 15 * 60 * 1000,
        });

        // Debug logging
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

    async getPlayerStats(brawlhallaId: number) {
        return this.limiter.schedule(() => this.performRequest(`/player/${brawlhallaId}/stats`));
    }

    async getRankings(bracket: '1v1' | '2v2' | 'rotational', region: string, page: number, name: string | null = null) {
        const params = name ? { name } : {};
        return this.limiter.schedule(() => this.performRequest(`/rankings/${bracket}/${region}/${page}`, params));
    }

    async searchPlayer(name: string) {
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