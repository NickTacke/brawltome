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
  BhV1Guild,
  BhV1GuildMembers,
  BhV1Legend,
  BhV1LegendsPage,
  BhV1PlayerGuild,
  BhV1PlayerStatsAll,
  BhV1PlayerStatsRanked,
  BhV1PlayerTeams,
  Bracket,
  Region,
  V1Mode,
} from './types'

const BASE_URL = 'https://api.brawlhalla.com'
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

export interface BhApiMetricsSink {
  incrementCounter(key: string): Promise<void>
}

export interface BhApiClientOptions {
  apiKey: string
  onDemandHeadroom?: number
  persistence?: RequestQueuePersistence
  baseUrl?: string
  fetchTimeoutMs?: number
  metrics?: BhApiMetricsSink
}

export interface CallOptions {
  caller?: Caller
}

export class BhApiClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly queue: RequestQueue
  private readonly fetchTimeoutMs: number
  private readonly metrics?: BhApiMetricsSink

  constructor(opts: BhApiClientOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl ?? BASE_URL
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    this.metrics = opts.metrics
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
    return this.call(`/search?steamid=${encodeURIComponent(steamId)}`, opts)
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
    const url = `${this.baseUrl}${endpoint}${separator}api_key=${this.apiKey}`
    return this.sendRequest<T>(url, path, endpoint)
  }

  private async callV1<T>(endpoint: string, opts: CallOptions): Promise<T | null> {
    const caller: Caller = opts.caller ?? 'background'
    const path = endpoint.split('?')[0]

    const waitMs = await this.queue.acquire(caller)
    if (waitMs > 0) {
      console.log(`[bhapi] ${path} queue wait: ${(waitMs / 1000).toFixed(1)}s (caller=${caller})`)
    }

    const remaining = this.remainingTokens(caller)
    console.log(`[bhapi] v1 ${path} (${remaining} ${caller} tokens left)`)

    const url = `${this.baseUrl}/v1${endpoint}`
    return this.sendRequest<T>(url, path, endpoint)
  }

  private async sendRequest<T>(url: string, path: string, endpoint: string): Promise<T | null> {
    const fetchStart = Date.now()
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(this.fetchTimeoutMs) })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        await this.metrics?.incrementCounter('bhapi:timeouts')
        throw new Error(`Brawlhalla API timeout for ${endpoint}`, { cause: err })
      }
      throw err
    }
    const fetchMs = Date.now() - fetchStart

    if (res.status === 404) {
      console.log(`[bhapi] ${path} -> 404 (${fetchMs}ms)`)
      return null
    }

    if (res.status === 429) {
      const parsed = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
      const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 5
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

    try {
      return (await res.json()) as T
    } catch (err) {
      // AbortSignal.timeout() also aborts the response body stream, so a body-read
      // timeout surfaces here as AbortError/TimeoutError. Route it to the timeout counter.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        await this.metrics?.incrementCounter('bhapi:timeouts')
        throw new Error(`Brawlhalla API timeout for ${endpoint}`, { cause: err })
      }
      await this.metrics?.incrementCounter('bhapi:json_errors')
      throw new Error(`Invalid JSON from Brawlhalla API for ${endpoint}`, { cause: err })
    }
  }

  async getPlayerStatsV1(id: number, mode: V1Mode = 'all', opts: CallOptions = {}): Promise<BhV1PlayerStatsAll | BhV1PlayerStatsRanked | null> {
    return this.callV1(`/player/stats?brawlhalla_id=${id}&mode=${mode}`, opts)
  }

  async getPlayerTeamsV1(id: number, opts: CallOptions = {}): Promise<BhV1PlayerTeams | null> {
    return this.callV1(`/player/teams?brawlhalla_id=${id}`, opts)
  }

  async getPlayerGuildV1(id: number, opts: CallOptions = {}): Promise<BhV1PlayerGuild | null> {
    return this.callV1(`/player/guild?brawlhalla_id=${id}`, opts)
  }

  async getGuildStatsV1(guildId: number, opts: CallOptions = {}): Promise<BhV1Guild | null> {
    return this.callV1(`/guild/stats?guild_id=${guildId}`, opts)
  }

  async getGuildMembersV1(guildId: number, opts: CallOptions = {}): Promise<BhV1GuildMembers | null> {
    return this.callV1(`/guild/members?guild_id=${guildId}`, opts)
  }

  async getAllLegendsV1(opts: CallOptions = {}): Promise<BhV1Legend[]> {
    const first = await this.callV1<BhV1LegendsPage>('/static/legends?page=1&max_results=100', opts)
    if (!first) return []
    const all = [...first.legends]
    for (let page = 2; page <= first.total_pages; page++) {
      const next = await this.callV1<BhV1LegendsPage>(`/static/legends?page=${page}&max_results=100`, opts)
      if (next) all.push(...next.legends)
    }
    return all
  }
}
