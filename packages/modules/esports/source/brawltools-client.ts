import type { RawLegendCount, RawMatch, RawPlacement, RawPlayer, RawPr } from './raw-types'

const defaultBaseUrl = 'https://api.brawltools.com/v2'
const defaultTimeoutMs = 10_000
const defaultRetryAfterSeconds = 60
const placementPageSize = 50
const legendPageSize = 10

export type GameMode = 1 | 2

export class BrawltoolsHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // a template such as /player/match, never with ids
    public readonly path: string,
  ) {
    super(message)
    this.name = 'BrawltoolsHttpError'
  }
}

export class BrawltoolsRateLimitError extends BrawltoolsHttpError {
  constructor(
    path: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(`brawltools rate limited ${path}, retry in ${retryAfterSeconds} s`, 429, path)
    this.name = 'BrawltoolsRateLimitError'
  }
}

// brawltools never answered: the request failed on the network or timed out
export class BrawltoolsNetworkError extends Error {
  constructor(
    message: string,
    // a template such as /player/match, never with ids
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BrawltoolsNetworkError'
  }
}

export type BrawltoolsClientOptions = {
  // spends one call of the brawltools source budget, or throws when there is none left
  admit: () => Promise<void>
  baseUrl?: string
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
}

export type BrawltoolsClient = {
  playerByBrawlhallaId(id: number): Promise<RawPlayer | null>
  powerRanking(playerId: number, mode: GameMode): Promise<RawPr | null>
  placements(playerId: number, mode: GameMode): Promise<RawPlacement[]>
  matches(playerId: number, tournamentId: string): Promise<RawMatch[]>
  eventLegends(playerId: number): Promise<RawLegendCount[]>
}

// brawltools answers the Retry-After header in seconds; a date is accepted too
function readRetryAfterSeconds(header: string | null): number {
  const seconds = Number.parseInt(header ?? '', 10)

  if (Number.isFinite(seconds) && seconds > 0) return seconds

  const dateMs = Date.parse(header ?? '')

  if (Number.isFinite(dateMs) && dateMs > Date.now()) return Math.ceil((dateMs - Date.now()) / 1_000)

  return defaultRetryAfterSeconds
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

export function createBrawltoolsClient(options: BrawltoolsClientOptions): BrawltoolsClient {
  const baseUrl = options.baseUrl ?? defaultBaseUrl
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const send = options.fetch ?? fetch

  function timeoutError(template: string, cause: unknown): BrawltoolsNetworkError {
    return new BrawltoolsNetworkError(`brawltools request timed out after ${timeoutMs} ms: ${template}`, template, {
      cause,
    })
  }

  async function sendRequest(template: string, pathAndQuery: string): Promise<Response> {
    try {
      return await send(`${baseUrl}${pathAndQuery}`, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      if (isTimeout(error)) throw timeoutError(template, error)

      // bun puts the full url, ids and all, in the error's path, so the original error is not kept as the cause
      throw new BrawltoolsNetworkError(`brawltools request failed: ${template}`, template)
    }
  }

  async function readBody<T>(response: Response, template: string): Promise<T> {
    try {
      return (await response.json()) as T
    } catch (error) {
      // the timeout signal also aborts the body stream, so a slow body ends up here
      if (isTimeout(error)) throw timeoutError(template, error)

      throw new Error(`brawltools sent invalid json: ${template}`, { cause: error })
    }
  }

  // null means the resource does not exist
  async function request<T>(template: string, pathAndQuery: string): Promise<T | null> {
    await options.admit()

    const response = await sendRequest(template, pathAndQuery)

    if (response.status === 404) return null

    if (response.status === 429) {
      throw new BrawltoolsRateLimitError(template, readRetryAfterSeconds(response.headers.get('retry-after')))
    }

    if (!response.ok) {
      throw new BrawltoolsHttpError(`brawltools answered ${response.status} for ${template}`, response.status, template)
    }

    return readBody<T>(response, template)
  }

  return {
    async playerByBrawlhallaId(id) {
      const body = await request<{ player: RawPlayer }>('/player/bhId/:id', `/player/bhId/${id}`)

      return body?.player ?? null
    },

    powerRanking(playerId, mode) {
      return request<RawPr>('/player/pr', `/player/pr?playerIds=${playerId}&gameMode=${mode}`)
    },

    async placements(playerId, mode) {
      const query = `playerIds=${playerId}&gameMode=${mode}&maxResults=${placementPageSize}`

      const body = await request<{ playerPlacements: RawPlacement[] }>(
        '/player/placement',
        `/player/placement?${query}`,
      )

      return body?.playerPlacements ?? []
    },

    async matches(playerId, tournamentId) {
      const query = `playerIds=${playerId}&tournamentId=${encodeURIComponent(tournamentId)}`
      const body = await request<{ playerMatches: RawMatch[] }>('/player/match', `/player/match?${query}`)

      return body?.playerMatches ?? []
    },

    async eventLegends(playerId) {
      const query = `playerIds=${playerId}&maxResults=${legendPageSize}`
      const body = await request<{ legends: RawLegendCount[] }>('/player/legend', `/player/legend?${query}`)

      return body?.legends ?? []
    },
  }
}
