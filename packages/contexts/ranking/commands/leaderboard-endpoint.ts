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
const RETRY_DELAY_MS = 1000

function buildUrl(bracket: Bracket, page: number): string {
  return `${BASE}?region=ALL&game_mode=${bracket}&page=${page}&max_results=50&leaderboard=prod`
}

async function fetchOnce(url: string): Promise<PageResponse> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`leaderboard endpoint ${res.status} for ${url}`)
  return (await res.json()) as PageResponse
}

export async function fetchLeaderboardPage(opts: { bracket: Bracket; page: number }): Promise<PageResponse> {
  const url = buildUrl(opts.bracket, opts.page)
  try {
    return await fetchOnce(url)
  } catch (firstErr) {
    void firstErr
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    try {
      return await fetchOnce(url)
    } catch (secondErr) {
      throw new Error(`fetchLeaderboardPage failed twice for ${url}: ${(secondErr as Error).message}`, {
        cause: secondErr,
      })
    }
  }
}
