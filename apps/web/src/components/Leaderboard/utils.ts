import type { AccountPreferencesContract } from '@brawltome/contracts'
import { buildQueryString, parseEnum, parseInteger } from '../../lib/searchParams'

export const BRACKETS = [
  { id: '1v1', label: '1v1' },
  { id: '2v2', label: '2v2' },
  { id: 'solo2v2', label: 'Solo 2v2' },
  { id: '3v3', label: '3v3' },
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

export type BracketId = (typeof BRACKETS)[number]['id']
export type RegionId = (typeof REGIONS)[number]['id']

export const BRACKET_IDS = BRACKETS.map((b) => b.id) as readonly BracketId[]
export const REGION_IDS = REGIONS.map((r) => r.id) as readonly RegionId[]

export const PAGE_SIZE = 20
export const MAX_PAGE = 500
export const DEFAULT_LEADERBOARD_PREFERENCES: AccountPreferencesContract = {
  version: 1,
  leaderboardBracket: '1v1',
  leaderboardRegion: 'all',
}

export interface LeaderboardFilters {
  bracket: BracketId
  region: RegionId
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
  losses?: number
  rank: number
  sourceRank?: number
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

export function parseLeaderboardSearchParams(
  params: URLSearchParams,
  preferences: AccountPreferencesContract = DEFAULT_LEADERBOARD_PREFERENCES,
): LeaderboardFilters {
  return {
    bracket: parseEnum(params.get('bracket'), BRACKET_IDS, preferences.leaderboardBracket),
    region: parseEnum(params.get('region'), REGION_IDS, preferences.leaderboardRegion),
    page: parseInteger(params.get('page'), { min: 1, max: MAX_PAGE, default: 1 }),
  }
}

export function preferencesForLeaderboardUpdate(
  current: LeaderboardFilters,
  next: Partial<LeaderboardFilters>,
  signedIn: boolean,
): AccountPreferencesContract | null {
  if (!signedIn || (next.bracket === undefined && next.region === undefined)) return null
  const merged = { ...current, ...next }
  return {
    version: 1,
    leaderboardBracket: merged.bracket,
    leaderboardRegion: merged.region,
  }
}

export function buildLeaderboardQueryString(filters: LeaderboardFilters): string {
  return buildQueryString({
    bracket: filters.bracket,
    region: filters.region,
    page: filters.page,
  })
}

export function displayedSoloStanding(
  bracket: BracketId,
  entry: SoloLeaderboardEntry,
  page: number,
  index: number,
): number {
  return bracket === '1v1' ? entry.rank : (page - 1) * PAGE_SIZE + index + 1
}

export function snapshotNotice(status: 'fresh' | 'stale' | 'unavailable' | null): string | null {
  if (status === 'stale') return 'Update delayed. Showing the last validated standings.'
  if (status === 'unavailable') return 'Leaderboard unavailable until the first validated collection succeeds.'
  return null
}

export function getRankStyle(rank: number): string {
  if (rank === 1) return 'text-yellow-500 font-black text-xl'
  if (rank === 2) return 'text-slate-400 font-black text-xl'
  if (rank === 3) return 'text-amber-700 font-black text-xl'
  return 'text-muted-foreground font-mono'
}
