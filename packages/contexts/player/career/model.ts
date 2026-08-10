import type { V0CareerSnapshot } from './source'

export const CAREER_FRESHNESS_SECONDS = 12 * 60 * 60
export const CAREER_FRESHNESS_MS = CAREER_FRESHNESS_SECONDS * 1_000

export type CareerFreshness = 'fresh' | 'stale' | 'unavailable'
export type CareerSnapshot = Omit<V0CareerSnapshot, 'brawlhallaId' | 'name'>
export type CareerPlayerProfile = {
  brawlhallaId: number
  checkedAt: Date
  lastSuccessAt: Date | null
  freshness: CareerFreshness
  freshForSeconds: typeof CAREER_FRESHNESS_SECONDS
  snapshot: CareerSnapshot | null
}

export interface CareerPlayerQueries {
  byId(brawlhallaId: number): Promise<CareerPlayerProfile | null>
}

export function careerFreshness(lastSuccessAt: Date | null, now = new Date()): CareerFreshness {
  if (!lastSuccessAt) return 'unavailable'
  return now.getTime() - lastSuccessAt.getTime() <= CAREER_FRESHNESS_MS ? 'fresh' : 'stale'
}
