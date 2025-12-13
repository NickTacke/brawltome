import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClanDTO, LegendDTO, PlayerDTO, PlayerRankedDTO, PlayerStatsDTO, Ranked2v2TeamDTO } from '@brawltome/shared-types';
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class BhApiClientService implements OnModuleInit, OnModuleDestroy {
    private limiter!: Bottleneck;
    private http: AxiosInstance;
    private readonly logger = new Logger(BhApiClientService.name);
    private readonly redisUrl: string;
    private isShuttingDown = false;

    constructor(private config: ConfigService) {
        this.redisUrl = this.config.getOrThrow<string>('REDIS_URL');
        const apiKey = this.config.getOrThrow<string>('BRAWLHALLA_API_KEY');

        // Initialize HTTP client
        this.http = axios.create({
            baseURL: 'https://api.brawlhalla.com',
            params: { api_key: apiKey },
            timeout: 10000, // 10s timeout
        });

        // Initialize rate limiter
        this.initLimiter();
    }

    private initLimiter() {
        if (this.limiter) {
            try {
                // Best effort disconnect
                this.limiter.disconnect();
            } catch (e) {
                this.logger.warn('Error disconnecting old limiter', e);
            }
        }

        const connection = new Bottleneck.IORedisConnection({
            client: new Redis(this.redisUrl),
        });

        this.limiter = new Bottleneck({
            // Cluster settings
            id: 'bhapi-limiter',
            datastore: 'ioredis',
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
        this.limiter.on('error', (err) => {
            this.logger.error('⚠️ Bottleneck error', err);
            // Handle UNKNOWN_CLIENT error by reconnecting
            if (err && err.message && err.message.includes('UNKNOWN_CLIENT')) {
                this.logger.warn('🔄 Redis client lost (UNKNOWN_CLIENT). Re-initializing limiter...');
                // Add a small delay to avoid rapid loops if the issue persists
                if(!this.isShuttingDown) {
                    setTimeout(() => this.initLimiter(), 1000);
                }
            }
        });
        
        this.limiter.on('depleted', () => this.logger.warn('⚠️ API Quota Depleted!'));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.limiter.on('failed', async (error, _jobInfo) => {
            const status = error.response?.status ?? error.status;
            if (status === 429) {
                this.logger.warn(`Rate limit 429 hit! Resetting reservoir to 0 and synchronizing wait time...`);
                
                try {
                    await this.limiter.updateSettings({
                        reservoir: 0,
                        reservoirRefreshAmount: 180,
                        reservoirRefreshInterval: 15 * 60 * 1000
                    });
                } catch (e) {
                    this.logger.error(`Failed to update limiter settings: ${e}`);
                }

                // Wait for the full refresh interval + buffer before retrying
                const waitTime = 15 * 60 * 1000 + 5000; 
                this.logger.warn(`Retrying request in ${waitTime}ms`);
                return waitTime;
            }
            return null;
        });
        
        this.logger.log(`Initialized Bottleneck with Redis at ${this.redisUrl.replace(/:\/\/.*@/, '://***@')}`);
    }

    onModuleInit() {
        this.logger.log('Brawlhalla Gatekeeper Initialized 🛡️');
    }

    async onModuleDestroy() {
        this.logger.log('Disconnecting BhApiClient...');
        this.isShuttingDown = true;
        await this.limiter.stop();
        await this.limiter.disconnect();
    }

    // -- Public Methods --

    async getRemainingTokens(): Promise<number> {
        const reservoir = await this.limiter.currentReservoir();
        return reservoir || 0;
    }

    async getPlayerStats(brawlhallaId: number): Promise<PlayerStatsDTO> {
        return this.limiter.schedule(() => this.performRequest(`/player/${brawlhallaId}/stats`));
    }

    async getPlayerRanked(brawlhallaId: number): Promise<PlayerRankedDTO> {
        return this.limiter.schedule(() => this.performRequest(`/player/${brawlhallaId}/ranked`));
    }

    async getRankings(bracket: '2v2', region: string, page: number, name?: string | null): Promise<Ranked2v2TeamDTO[]>;
    async getRankings(bracket: '1v1' | 'rotational', region: string, page: number, name?: string | null): Promise<PlayerDTO[]>;
    async getRankings(bracket: '1v1' | '2v2' | 'rotational', region: string, page: number, name: string | null = null): Promise<PlayerDTO[] | Ranked2v2TeamDTO[]> {
        const params = name ? { name } : {};
        return this.limiter.schedule(() => this.performRequest(`/rankings/${bracket}/${region}/${page}`, params));
    }

    async searchPlayer(name: string): Promise<PlayerDTO[]> {
        return this.getRankings('1v1', 'all', 1, name);
    }

    async getAllLegends(): Promise<LegendDTO[]> {
        return this.limiter.schedule(() => this.performRequest(`/legend/all`));
    }

    async getLegend(legendId: number): Promise<LegendDTO> {
        return this.limiter.schedule(() => this.performRequest(`/legend/${legendId}`));
    }

    async getClan(clanId: number): Promise<ClanDTO> {
        return this.limiter.schedule(() => this.performRequest(`/clan/${clanId}`));
    }

    // -- Private Methods --

    private async performRequest(endpoint: string, params: Record<string, unknown> = {}) {
        try {
            const response = await this.http.get(endpoint, { params });
            return response.data;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            const status = error.response?.status ?? error.status;
            if (status === 429) {
                this.logger.error(`ALERT! Rate Limit Exceeded Unexpectedly!`);
            }
            throw error;
        }
    }
}
