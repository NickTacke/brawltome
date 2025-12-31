const API_URL = process.env.API_URL || 'http://localhost:8080';

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

export async function getPlayer(id: number): Promise<PlayerResponse> {
  return fetchApi<PlayerResponse>(`/player/${id}`);
}

export async function getClan(id: number): Promise<ClanResponse> {
  return fetchApi<ClanResponse>(`/clan/${id}`);
}

export async function search(query: string): Promise<SearchResponse> {
  const encodedQuery = encodeURIComponent(query);
  return fetchApi<SearchResponse>(`/search/local?q=${encodedQuery}`);
}

export { ApiError };
