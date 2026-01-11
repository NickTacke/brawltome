import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClanDTO,
  LegendDTO,
  PlayerRankedDTO,
  PlayerStatsDTO,
  RankingBracket,
  RankingsResponseMap,
  Region,
} from '@brawltome/shared-types';
import { PRIORITY_BACKGROUND } from '@brawltome/shared-utils';
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';
import axios, { AxiosInstance } from 'axios';

export interface BhApiRequestOptions {
  /** Bottleneck priority (lower = higher priority). Defaults to PRIORITY_BACKGROUND. */
  priority?: number;
}

@Injectable()
export class BhApiClientService implements OnModuleDestroy {
  public limiter!: Bottleneck;
  private http: AxiosInstance;
  private readonly logger = new Logger(BhApiClientService.name);
  private redisClient: Redis;
  private connection: Bottleneck.IORedisConnection;
  private lastBottleneckErrorTime = 0;
  private bottleneckErrorCount = 0;
  private readonly BOTTLENECK_ERROR_DEBOUNCE_MS = 5000;

  constructor(private config: ConfigService) {
    this.redisClient = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null, // Required for Bottleneck
      enableReadyCheck: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(
          `Redis reconnecting... attempt ${times}, delay ${delay}ms`,
        );
        return delay;
      },
    });

    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error:', err.message);
    });

    this.redisClient.on('connect', () => {
      this.logger.log('Redis client connected');
      // Reset error tracking on successful connection
      this.bottleneckErrorCount = 0;
      this.lastBottleneckErrorTime = 0;
    });

    this.redisClient.on('reconnecting', () => {
      this.logger.warn('Redis client reconnecting...');
    });

    this.connection = new Bottleneck.IORedisConnection({
      client: this.redisClient,
    });

    this.connection.on('error', (err) => {
      this.logger.error('Bottleneck Redis connection error:', err.message);
    });

    const apiKey = this.config.getOrThrow<string>('BRAWLHALLA_API_KEY');

    this.limiter = new Bottleneck({
      id: 'bhapi-limiter',
      datastore: 'ioredis',
      connection: this.connection,
      clearDatastore: false,

      // Traffic settings
      minTime: 150,
      maxConcurrent: 1,

      // Economy settings
      reservoir: 180,
      reservoirRefreshAmount: 180,
      reservoirRefreshInterval: 15 * 60 * 1000,
    });

    this.limiter.on('error', (error) => {
      const now = Date.now();
      const isRedisConnectionError =
        error.message?.includes('UNKNOWN_CLIENT') ||
        error.message?.includes('READONLY') ||
        error.message?.includes('LOADING') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNREFUSED';

      if (isRedisConnectionError) {
        this.bottleneckErrorCount++;
        // Only log once every DEBOUNCE_MS during connection issues
        if (
          now - this.lastBottleneckErrorTime >
          this.BOTTLENECK_ERROR_DEBOUNCE_MS
        ) {
          this.logger.warn(
            `Bottleneck Redis connection issue (${this.bottleneckErrorCount} errors since last log): ${error.message}`,
          );
          this.lastBottleneckErrorTime = now;
          this.bottleneckErrorCount = 0;
        }
      } else {
        // Non-connection errors are always logged
        this.logger.error('Bottleneck error', error);
      }
    });

    this.limiter.on('depleted', () =>
      this.logger.warn('API quota depleted. Pausing...'),
    );

    this.limiter.on('failed', async (error, jobInfo) => {
      const status = error.response?.status ?? error.status;
      const endpoint = error.config?.url;

      if (status === 429) {
        const retryHeader = error.response?.headers['retry-after'];
        const retryAfter = retryHeader ? parseInt(retryHeader, 10) : 900;
        const waitTime = (retryAfter + 1) * 1000;

        this.logger.warn(
          `Rate limit 429 hit! Backing off for ${waitTime / 1000}s`,
        );

        return waitTime;
      }

      if (
        status >= 500 ||
        error.code == 'ECONNRESET' ||
        error.code == 'ETIMEDOUT'
      ) {
        if (jobInfo.retryCount < 1) {
          this.logger.error(
            `API Error [${status}] on ${endpoint}: ${
              error.message
            } - ${JSON.stringify(error.response?.data || {})}`,
          );
          return 1000;
        }
      }

      this.handleAxiosError(error, endpoint);
      return null;
    });

    this.http = axios.create({
      baseURL: 'https://api.brawlhalla.com',
      params: { api_key: apiKey },
      timeout: 10000,
    });
  }

  async getRemainingTokens(): Promise<number> {
    const reservoir = await this.limiter.currentReservoir();
    return reservoir || 0;
  }

  async getPlayerStats(
    brawlhallaId: number,
    options: BhApiRequestOptions = {},
  ): Promise<PlayerStatsDTO> {
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () => this.performRequest(`/player/${brawlhallaId}/stats`),
    );
  }

  async getPlayerRanked(
    brawlhallaId: number,
    options: BhApiRequestOptions = {},
  ): Promise<PlayerRankedDTO> {
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () => this.performRequest(`/player/${brawlhallaId}/ranked`),
    );
  }

  async getRankings<K extends RankingBracket>(
    bracket: K,
    region: Region,
    page: number,
    name: string | null = null,
    options: BhApiRequestOptions = {},
  ): Promise<RankingsResponseMap[K]> {
    const params = name ? { name } : {};
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () =>
        this.performRequest(`/rankings/${bracket}/${region}/${page}`, params),
    );
  }

  async getAllLegends(options: BhApiRequestOptions = {}): Promise<LegendDTO[]> {
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () => this.performRequest(`/legend/all`),
    );
  }

  async getLegend(
    legendId: number,
    options: BhApiRequestOptions = {},
  ): Promise<LegendDTO> {
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () => this.performRequest(`/legend/${legendId}`),
    );
  }

  async getClan(
    clanId: number,
    options: BhApiRequestOptions = {},
  ): Promise<ClanDTO> {
    return this.limiter.schedule(
      { priority: options.priority ?? PRIORITY_BACKGROUND },
      () => this.performRequest(`/clan/${clanId}`),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAxiosError(error: any, endpoint: string) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      let dataStr = JSON.stringify(error.response?.data || {});
      if (dataStr.length > 500) {
        dataStr = dataStr.substring(0, 500) + '...';
      }
      this.logger.error(
        `API Error [${status}] on ${endpoint}: ${error.message} - ${dataStr}`,
      );
    } else {
      this.logger.error(`Unknown error on ${endpoint}: ${error.message}`);
    }
  }

  private async performRequest(
    endpoint: string,
    params: Record<string, unknown> = {},
  ) {
    const response = await this.http.get(endpoint, { params });
    return response.data;
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down BhApiClientService...');
    await this.limiter.disconnect();
    await this.redisClient.quit();
  }
}
