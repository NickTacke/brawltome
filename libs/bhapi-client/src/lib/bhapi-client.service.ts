import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClanDTO,
  LegendDTO,
  PlayerDTO,
  PlayerRankedDTO,
  PlayerStatsDTO,
  Ranked2v2TeamDTO,
} from '@brawltome/shared-types';
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class BhApiClientService {
  public limiter!: Bottleneck;
  private http: AxiosInstance;
  private readonly logger = new Logger(BhApiClientService.name);

  constructor(private config: ConfigService) {
    // Create redis connection specifically for Bottleneck
    const connection = new Bottleneck.IORedisConnection({
      client: new Redis(this.config.getOrThrow<string>('REDIS_URL')),
    });

    const apiKey = this.config.getOrThrow<string>('BRAWLHALLA_API_KEY');

    // Initialize Bottleneck limiter
    this.limiter = new Bottleneck({
      id: 'bhapi-limiter',
      datastore: 'ioredis',
      connection,
      clearDatastore: false,

      // Traffic settings
      minTime: 100,
      maxConcurrent: 5,

      // Economy settings
      reservoir: 180,
      reservoirRefreshAmount: 180,
      reservoirRefreshInterval: 15 * 60 * 1000,
    });

    // Event handlers
    this.limiter.on('error', (error) => {
      this.logger.error('Bottleneck error', error);
      // Bottleneck will automatically retry the request
    });

    this.limiter.on('depleted', () =>
      this.logger.warn('API quota depleted. Pausing...')
    );

    this.limiter.on('failed', async (error) => {
      const status = error.response?.status ?? error.status;

      if (status === 429) {
        // Try to read retry-after header (not sure if brawlhalla includes this, will check)
        const retryHeader = error.response?.headers['retry-after'];
        // Default to 15 minutes if retry-after header is not present
        const retryAfter = retryHeader ? parseInt(retryHeader, 10) : 900;

        // Print all headers/data to see what's available (TODO: remove this after testing)
        this.logger.warn('Headers:', error.response?.headers);
        this.logger.warn('Response:', error.response?.data);

        // Add a second buffer for safety
        const waitTime = (retryAfter + 1) * 1000;

        this.logger.warn(
          `Rate limit 429 hit! Backing off for ${waitTime / 1000}s`
        );

        // Reset reservoir to 0 to stop workers from starving
        try {
          await this.limiter.updateSettings({ reservoir: 0 });
        } catch (err) {
          this.logger.error('Failed to update limiter settings', err);
        }

        // Return the wait time, Bottleneck will handle the delay
        return waitTime;
      }

      // Do not retry
      return null;
    });

    // Initialize HTTP client
    this.http = axios.create({
      baseURL: 'https://api.brawlhalla.com',
      params: { api_key: apiKey },
      timeout: 10000, // 10s timeout
    });
  }

  // -- Public Methods --

  async getRemainingTokens(): Promise<number> {
    const reservoir = await this.limiter.currentReservoir();
    return reservoir || 0;
  }

  async getPlayerStats(brawlhallaId: number): Promise<PlayerStatsDTO> {
    return this.limiter.schedule(() =>
      this.performRequest(`/player/${brawlhallaId}/stats`)
    );
  }

  async getPlayerRanked(brawlhallaId: number): Promise<PlayerRankedDTO> {
    return this.limiter.schedule(() =>
      this.performRequest(`/player/${brawlhallaId}/ranked`)
    );
  }

  async getRankings(
    bracket: '1v1' | '2v2' | 'rotational',
    region: string,
    page: number,
    name: string | null = null
  ): Promise<PlayerDTO[] | Ranked2v2TeamDTO[]> {
    const params = name ? { name } : {};
    return this.limiter.schedule(() =>
      this.performRequest(`/rankings/${bracket}/${region}/${page}`, params)
    );
  }

  async searchPlayer(name: string): Promise<PlayerDTO[]> {
    return this.getRankings('1v1', 'all', 1, name) as Promise<PlayerDTO[]>;
  }

  async getAllLegends(): Promise<LegendDTO[]> {
    return this.limiter.schedule(() => this.performRequest(`/legend/all`));
  }

  async getLegend(legendId: number): Promise<LegendDTO> {
    return this.limiter.schedule(() =>
      this.performRequest(`/legend/${legendId}`)
    );
  }

  async getClan(clanId: number): Promise<ClanDTO> {
    return this.limiter.schedule(() => this.performRequest(`/clan/${clanId}`));
  }

  // -- Private Methods --

  private async performRequest(
    endpoint: string,
    params: Record<string, unknown> = {}
  ) {
    try {
      const response = await this.http.get(endpoint, { params });
      return response.data;
    } catch (error) {
      // Can keep track in Railway logs
      this.logger.error('Request failed', error);
      throw error;
    }
  }
}
