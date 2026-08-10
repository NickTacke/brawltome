import type { V0RankedSnapshot } from './source'

export const RANKED_FRESHNESS_SECONDS = 60 * 60
export const RANKED_FRESHNESS_MS = RANKED_FRESHNESS_SECONDS * 1_000

export type RankedFreshness = 'fresh' | 'stale' | 'unavailable'
export type RankedPulseSourceStatus = { checkedAt: Date; lastSuccessAt: Date | null }
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
export type ObservedRatingDirection = {
  direction: 'up' | 'down' | 'unchanged'
  ratingChange: number
  observationCount: number
  fromObservedAt: Date
  toObservedAt: Date
}
export type RankedSnapshot = Omit<V0RankedSnapshot, 'brawlhallaId' | 'name' | 'rankedMainLegend'> & {
  mainLegend: MainLegend | null
  ratingHistory: RatingHistoryPoint[]
  observedRatingDirection: ObservedRatingDirection | null
}
export type RankedPlayerProfile = {
  brawlhallaId: number
  checkedAt: Date
  lastSuccessAt: Date | null
  freshness: RankedFreshness
  freshForSeconds: typeof RANKED_FRESHNESS_SECONDS
  sparsePulse: RankedPulseSourceStatus | null
  snapshot: RankedSnapshot | null
}

export interface RankedPlayerQueries {
  byId(brawlhallaId: number): Promise<RankedPlayerProfile | null>
}

export function rankedFreshness(lastSuccessAt: Date | null, now = new Date()): RankedFreshness {
  if (!lastSuccessAt) return 'unavailable'
  return now.getTime() - lastSuccessAt.getTime() <= RANKED_FRESHNESS_MS ? 'fresh' : 'stale'
}

export function deriveObservedRatingDirection(
  newestFirstHistory: RatingHistoryPoint[],
): ObservedRatingDirection | null {
  if (newestFirstHistory.length < 2) return null

  const chronologicalHistory = [...newestFirstHistory].reverse()
  let segmentStart = 0
  for (let index = 1; index < chronologicalHistory.length; index += 1) {
    if (chronologicalHistory[index].games < chronologicalHistory[index - 1].games) segmentStart = index
  }

  const currentSeasonHistory = chronologicalHistory.slice(segmentStart)
  if (currentSeasonHistory.length < 2) return null

  const from = currentSeasonHistory[0]
  const to = currentSeasonHistory[currentSeasonHistory.length - 1]
  const ratingChange = to.rating - from.rating
  return {
    direction: ratingChange > 0 ? 'up' : ratingChange < 0 ? 'down' : 'unchanged',
    ratingChange,
    observationCount: currentSeasonHistory.length,
    fromObservedAt: from.recordedAt,
    toObservedAt: to.recordedAt,
  }
}
