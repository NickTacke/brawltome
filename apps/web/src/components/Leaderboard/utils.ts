import { buildQueryString, parseEnum, parseInteger } from '../../lib/searchParams'

export const BRACKETS = [
  { id: '1v1', label: '1v1' },
  { id: '2v2', label: '2v2' },
  { id: 'solo2v2', label: 'Solo 2v2' },
] as const

export const REGIONS = [
  { id: 'all', label: 'Global' },
  { id: 'US-E', label: 'US-E' },
  { id: 'US-W', label: 'US-W' },
  { id: 'EU', label: 'Europe' },
  { id: 'SEA', label: 'SEA' },
  { id: 'AUS', label: 'AUS' },
  { id: 'BRZ', label: 'Brazil' },
  { id: 'JPN', label: 'Japan' },
  { id: 'ME', label: 'Middle East' },
  { id: 'SA', label: 'South Africa' },
] as const

export const BRACKET_IDS = ['1v1', '2v2', 'solo2v2'] as const
export const REGION_IDS = ['all', 'US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export const SORT_FIELDS = ['rating', 'peakRating', 'wins', 'games'] as const
export const SORT_ORDERS = ['asc', 'desc'] as const

export type BracketId = (typeof BRACKET_IDS)[number]
export type RegionId = (typeof REGION_IDS)[number]
export type SortField = (typeof SORT_FIELDS)[number]
export type SortOrder = (typeof SORT_ORDERS)[number]

export const PAGE_SIZE = 20
export const MAX_PAGE = 200

export interface LeaderboardFilters {
  bracket: BracketId
  region: RegionId
  sortField: SortField
  sortOrder: SortOrder
  page: number
}

export interface SoloLeaderboardEntry {
  brawlhallaId: number
  name: string
  region: string
  rating: number
  peakRating: number | null
  tier: string | null
  bestLegendNameKey?: string | null
  rankedWins?: number
  rankedGames?: number
  wins?: number
  games?: number
  rank?: number
}

export interface TeamLeaderboardEntry {
  brawlhallaIdOne: number
  brawlhallaIdTwo: number
  playerOneName: string
  playerTwoName: string
  teamName?: string | null
  region: string
  rating: number
  peakRating: number | null
  tier: string | null
  wins: number
  games: number
  rank: number
}

export type LeaderboardEntry = SoloLeaderboardEntry | TeamLeaderboardEntry

export function isTeamEntry(entry: LeaderboardEntry): entry is TeamLeaderboardEntry {
  return 'brawlhallaIdOne' in entry && 'brawlhallaIdTwo' in entry
}

export function parseLeaderboardSearchParams(params: URLSearchParams): LeaderboardFilters {
  return {
    bracket: parseEnum(params.get('bracket'), BRACKET_IDS, '1v1'),
    region: parseEnum(params.get('region'), REGION_IDS, 'all'),
    sortField: parseEnum(params.get('sort'), SORT_FIELDS, 'rating'),
    sortOrder: parseEnum(params.get('order'), SORT_ORDERS, 'desc'),
    page: parseInteger(params.get('page'), { min: 1, max: MAX_PAGE, default: 1 }),
  }
}

export function buildLeaderboardQueryString(filters: LeaderboardFilters): string {
  return buildQueryString({
    bracket: filters.bracket,
    region: filters.region,
    sort: filters.sortField,
    order: filters.sortOrder,
    page: filters.page,
  })
}

export function getRankStyle(rank: number): string {
  if (rank === 1) return 'text-yellow-500 font-black text-xl'
  if (rank === 2) return 'text-slate-400 font-black text-xl'
  if (rank === 3) return 'text-amber-700 font-black text-xl'
  return 'text-muted-foreground font-mono'
}
