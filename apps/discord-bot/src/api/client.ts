const API_URL = process.env.API_URL || 'http://localhost:8080';

// Types for API responses
export interface PlayerResponse {
  brawlhallaId: number;
  name: string;
  region: string;
  rating: number;
  peakRating: number;
  tier: string;
  games: number;
  wins: number;
  viewCount: number;
  isRefreshing: boolean;
  aliases?: Array<{ key: string; value: string }>;
  stats?: {
    level: number;
    xp: number;
    games: number;
    wins: number;
    playtimeSeconds?: number;
    clan?: {
      clanName: string;
      clanId: number;
    };
    legendsEnriched?: Array<{
      legendId: number;
      legendNameKey: string;
      bioName?: string;
      level: number;
      xp: number;
      games: number;
      wins: number;
      kos: number;
      matchTime: number;
      ranked?: {
        rating: number;
        peakRating: number;
        tier: string;
        wins: number;
        games: number;
      };
    }>;
    weaponStats?: Array<{
      weapon: string;
      timeHeld: number;
      damage: string;
      KOs: number;
      share: number;
    }>;
  };
  ranked?: {
    legends: Array<{
      legendId: number;
      legendNameKey: string;
      bioName?: string;
      rating: number;
      peakRating: number;
      tier: string;
      wins: number;
      games: number;
    }>;
    teams: Array<{
      brawlhallaIdOne: number;
      brawlhallaIdTwo: number;
      teamName: string;
      rating: number;
      peakRating: number;
      tier: string;
      wins: number;
      games: number;
    }>;
  };
}

export interface ClanResponse {
  clanId: number;
  clanName: string;
  clanCreateDate: string;
  clanXp: string;
  clanLifetimeXp: number;
  isRefreshing: boolean;
  members: Array<{
    brawlhallaId: number;
    name: string;
    rank: string;
    joinDate: string;
    xp: number;
    legendNameKey?: string;
    elo?: number;
    peakElo?: number;
  }>;
}

export interface SearchResponse {
  players: Array<{
    brawlhallaId: number;
    name: string;
    region: string;
    rating: number;
    tier: string;
    games: number;
    wins: number;
    bestLegendName?: string;
    bestLegendNameKey?: string;
    matchedOn?: 'name' | 'alias';
    matchedAlias?: string;
  }>;
  clans: Array<{
    clanId: number;
    name: string;
    xp: string;
    memberCount: number;
  }>;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetches JSON from the configured API by requesting the provided endpoint and returns the parsed response.
 *
 * @param endpoint - The API path appended to the base API_URL (e.g. `/player/123`)
 * @returns The parsed response object of type `T`
 * @throws ApiError when the HTTP response status is not OK; `status` contains the HTTP status code and the error message contains the response body text
 */
async function fetchApi<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  console.log(`[API] GET ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new ApiError(response.status, errorText);
  }

  return response.json() as Promise<T>;
}

/**
 * Fetches player data for the given player ID.
 *
 * @returns The player's detailed information as a `PlayerResponse`.
 */
export async function getPlayer(id: number): Promise<PlayerResponse> {
  return fetchApi<PlayerResponse>(`/player/${id}`);
}

/**
 * Fetches clan details for the given clan ID.
 *
 * @param id - The clan's numeric identifier
 * @returns The clan details as a `ClanResponse`
 */
export async function getClan(id: number): Promise<ClanResponse> {
  return fetchApi<ClanResponse>(`/clan/${id}`);
}

/**
 * Searches local players and clans that match the given query.
 *
 * @param query - Search string used to find players and clans; it will be URL-encoded before sending
 * @returns A SearchResponse containing arrays of matching players and clans
 */
export async function search(query: string): Promise<SearchResponse> {
  const encodedQuery = encodeURIComponent(query);
  return fetchApi<SearchResponse>(`/search/local?q=${encodedQuery}`);
}

export { ApiError };