export type Bracket = '1v1' | '2v2' | 'solo_2v2' | '3v3'

export interface PageEntry {
  id?: number
  username?: string
  players?: { id: number; username: string }[]
  rating: number
  best_rating: number
  rank: number
  wins: number
  losses: number
  region?: string
  tier?: string
}

export interface PageResponse {
  rankings: PageEntry[]
  total_pages: number
}

const BASE = 'https://api.brawlhalla.com/v1/leaderboard/ranked'
const TIMEOUT_MS = 15_000
// Exponential backoff: 1s, 3s. Jitter spreads retries when 20 concurrent workers
// stampede the same upstream 502 at the same instant.
const RETRY_BACKOFFS_MS = [1000, 3000]
const JITTER_MS = 300

// Codebase uses 'JPN' for Japan; the upstream endpoint expects 'JPS' on the way out
// (and returns 'JPS' on the way in, which `normalizeRegion` flips back to 'JPN').
const REGION_TO_API: Record<string, string> = { JPN: 'JPS' }

function regionToApi(region: string): string {
  return REGION_TO_API[region] ?? region
}

function buildUrl(bracket: Bracket, page: number, region: string): string {
  const apiRegion = regionToApi(region)
  return `${BASE}?region=${apiRegion}&game_mode=${bracket}&page=${page}&max_results=50&leaderboard=prod`
}

async function fetchOnce(url: string): Promise<PageResponse> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`leaderboard endpoint ${res.status} for ${url}`)
  return (await res.json()) as PageResponse
}

function jitter(baseMs: number): number {
  return baseMs + (Math.random() * 2 - 1) * JITTER_MS
}

export async function fetchLeaderboardPage(opts: {
  bracket: Bracket
  page: number
  region: string
}): Promise<PageResponse> {
  const url = buildUrl(opts.bracket, opts.page, opts.region)
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      return await fetchOnce(url)
    } catch (err) {
      lastErr = err
      if (attempt === RETRY_BACKOFFS_MS.length) break
      const delay = jitter(RETRY_BACKOFFS_MS[attempt])
      console.warn(
        `[sweep] page retry ${attempt + 1}/${RETRY_BACKOFFS_MS.length} after error: ${(err as Error).message} (${url})`,
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error(
    `fetchLeaderboardPage failed after ${RETRY_BACKOFFS_MS.length + 1} attempts for ${url}: ${(lastErr as Error).message}`,
    { cause: lastErr },
  )
}
