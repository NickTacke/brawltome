import type { V0RankedSnapshot } from './source'

export const RANKED_FRESHNESS_SECONDS = 60 * 60
export const RANKED_FRESHNESS_MS = RANKED_FRESHNESS_SECONDS * 1_000

export type RankedFreshness = 'fresh' | 'stale' | 'unavailable'
export type MainLegend = {
  legendId: number
  legendNameKey: string
  source: 'current-season' | 'career'
}
export type RatingHistoryPoint = {
  rating: number
  peakRating: number
  tier: string
  wins: number
  games: number
  recordedAt: Date
}
export type RankedSnapshot = Omit<V0RankedSnapshot, 'brawlhallaId' | 'name' | 'rankedMainLegend'> & {
  mainLegend: MainLegend | null
  ratingHistory: RatingHistoryPoint[]
}
export type RankedPlayerProfile = {
  brawlhallaId: number
  checkedAt: Date
  lastSuccessAt: Date | null
  freshness: RankedFreshness
  freshForSeconds: typeof RANKED_FRESHNESS_SECONDS
  snapshot: RankedSnapshot | null
}

export interface RankedPlayerQueries {
  byId(brawlhallaId: number): Promise<RankedPlayerProfile | null>
}

export function rankedFreshness(lastSuccessAt: Date | null, now = new Date()): RankedFreshness {
  if (!lastSuccessAt) return 'unavailable'
  return now.getTime() - lastSuccessAt.getTime() <= RANKED_FRESHNESS_MS ? 'fresh' : 'stale'
}
