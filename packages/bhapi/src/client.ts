import { type Caller, RequestQueue, type RequestQueuePersistence } from './request-queue'

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}
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
  onDemandHeadroom?: number
  persistence?: RequestQueuePersistence
}

export interface CallOptions {
  caller?: Caller
}

export class BhApiClient {
  private readonly apiKey: string
  private readonly queue: RequestQueue

  constructor(opts: BhApiClientOptions) {
    this.apiKey = opts.apiKey
    this.queue = new RequestQueue({
      minSpacingMs: 150,
      sustainedLimit: 180,
      sustainedWindowMs: 15 * 60 * 1000,
      onDemandHeadroom: opts.onDemandHeadroom ?? 30,
      persistence: opts.persistence,
    })
  }

  async init(): Promise<void> {
    await this.queue.init()
  }

  remainingTokens(caller: Caller = 'background'): number {
    return caller === 'on-demand' ? this.queue.remainingOnDemand : this.queue.remainingBackground
  }

  get pausedUntilMs(): number {
    return this.queue.pausedUntilMs
  }

  async searchBySteamId(steamId: string, opts: CallOptions = {}): Promise<BhApiSearchResult | null> {
    return this.call(`/search?steamid=${steamId}`, opts)
  }

  async getRankings1v1(region: Region, page: number, opts: CallOptions = {}): Promise<BhApiRanking1v1[]> {
    return (await this.call<BhApiRanking1v1[]>(`/rankings/1v1/${region}/${page}`, opts)) ?? []
  }

  async getRankings2v2(region: Region, page: number, opts: CallOptions = {}): Promise<BhApiRanking2v2[]> {
    return (await this.call<BhApiRanking2v2[]>(`/rankings/2v2/${region}/${page}`, opts)) ?? []
  }

  async getPlayerStats(id: number, opts: CallOptions = {}): Promise<BhApiPlayerStats | null> {
    return this.call(`/player/${id}/stats`, opts)
  }

  async getPlayerRanked(id: number, opts: CallOptions = {}): Promise<BhApiPlayerRanked | null> {
    return this.call(`/player/${id}/ranked`, opts)
  }

  async getClan(id: number, opts: CallOptions = {}): Promise<BhApiClan | null> {
    return this.call(`/clan/${id}`, opts)
  }

  async getAllLegends(opts: CallOptions = {}): Promise<BhApiLegend[]> {
    return (await this.call<BhApiLegend[]>('/legend/all', opts)) ?? []
  }

  async getLegend(id: number, opts: CallOptions = {}): Promise<BhApiLegendFull | null> {
    return this.call(`/legend/${id}`, opts)
  }

  private async call<T>(endpoint: string, opts: CallOptions): Promise<T | null> {
    const caller: Caller = opts.caller ?? 'background'
    const path = endpoint.split('?')[0]

    const waitMs = await this.queue.acquire(caller)
    if (waitMs > 0) {
      console.log(`[bhapi] ${path} queue wait: ${(waitMs / 1000).toFixed(1)}s (caller=${caller})`)
    }

    const remaining = this.remainingTokens(caller)
    console.log(`[bhapi] ${path} (${remaining} ${caller} tokens left)`)

    const separator = endpoint.includes('?') ? '&' : '?'
    const url = `${BASE_URL}${endpoint}${separator}api_key=${this.apiKey}`

    const fetchStart = Date.now()
    const res = await fetch(url)
    const fetchMs = Date.now() - fetchStart

    if (res.status === 404) {
      console.log(`[bhapi] ${path} -> 404 (${fetchMs}ms)`)
      return null
    }

    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '5', 10)
      console.warn(
        `[bhapi] ${path} -> 429 UNEXPECTED (${fetchMs}ms, retry-after: ${retryAfter}s) — queue should have prevented this`,
      )

      const pauseMs = (retryAfter + 1) * 1000
      this.queue.pause(pauseMs)
      console.warn(`[bhapi] paused queue for ${retryAfter + 1}s`)

      throw new RateLimitError(`Brawlhalla API rate limited for ${endpoint}`, pauseMs)
    }

    if (!res.ok) {
      console.log(`[bhapi] ${path} -> ${res.status} (${fetchMs}ms)`)
      throw new Error(`Brawlhalla API error: ${res.status} ${res.statusText} for ${endpoint}`)
    }

    if (fetchMs > 5000) {
      console.log(`[bhapi] ${path} -> 200 SLOW (${fetchMs}ms)`)
    }

    return res.json() as Promise<T>
  }
}
