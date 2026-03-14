import { TokenBucket } from './rate-limiter'
import type {
  BhApiClan,
  BhApiLegend,
  BhApiLegendFull,
  BhApiPlayerRanked,
  BhApiPlayerStats,
  BhApiRanking1v1,
  BhApiRanking2v2,
  BhApiSearchResult,
  Bracket,
  Region,
} from './types'

const BASE_URL = 'https://api.brawlhalla.com'

export interface BhApiClientOptions {
  apiKey: string
}

export class BhApiClient {
  private readonly apiKey: string
  private readonly burst: TokenBucket
  private readonly sustained: TokenBucket

  constructor(opts: BhApiClientOptions) {
    this.apiKey = opts.apiKey
    this.burst = new TokenBucket({ capacity: 10, refillRate: 10, intervalMs: 1000 })
    // 180 tokens per 15 min = 1 token every 5 seconds
    this.sustained = new TokenBucket({ capacity: 180, refillRate: 1, intervalMs: 5000 })
  }

  get remainingTokens(): number {
    return this.sustained.remaining
  }

  async searchBySteamId(steamId: string): Promise<BhApiSearchResult | null> {
    return this.call(`/search?steamid=${steamId}`)
  }

  async getRankings1v1(region: Region, page: number): Promise<BhApiRanking1v1[]> {
    return (await this.call<BhApiRanking1v1[]>(`/rankings/1v1/${region}/${page}`)) ?? []
  }

  async getRankings2v2(region: Region, page: number): Promise<BhApiRanking2v2[]> {
    return (await this.call<BhApiRanking2v2[]>(`/rankings/2v2/${region}/${page}`)) ?? []
  }

  async getPlayerStats(id: number): Promise<BhApiPlayerStats | null> {
    return this.call(`/player/${id}/stats`)
  }

  async getPlayerRanked(id: number): Promise<BhApiPlayerRanked | null> {
    return this.call(`/player/${id}/ranked`)
  }

  async getClan(id: number): Promise<BhApiClan | null> {
    return this.call(`/clan/${id}`)
  }

  async getAllLegends(): Promise<BhApiLegend[]> {
    return (await this.call<BhApiLegend[]>('/legend/all')) ?? []
  }

  async getLegend(id: number): Promise<BhApiLegendFull | null> {
    return this.call(`/legend/${id}`)
  }

  private async call<T>(endpoint: string): Promise<T | null> {
    await this.burst.acquire('burst')
    await this.sustained.acquire('sustained')

    const separator = endpoint.includes('?') ? '&' : '?'
    const url = `${BASE_URL}${endpoint}${separator}api_key=${this.apiKey}`

    const res = await fetch(url)

    if (res.status === 404) return null

    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '5', 10)
      await Bun.sleep((retryAfter + 1) * 1000)
      return this.call<T>(endpoint)
    }

    if (!res.ok) {
      throw new Error(`Brawlhalla API error: ${res.status} ${res.statusText} for ${endpoint}`)
    }

    return res.json() as Promise<T>
  }
}
