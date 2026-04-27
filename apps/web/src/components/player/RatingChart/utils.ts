import { formatDate } from '../../../lib/format'

export interface SeasonDef {
  id: number
  name: string
  startsAt: Date
}

export const SEASONS: SeasonDef[] = [
  { id: 39, name: 'Season 39', startsAt: new Date(0) },
  { id: 40, name: 'Season 40', startsAt: new Date('2026-03-25T14:00:00Z') },
]

export interface TierThreshold {
  name: string
  minRating: number
  color: string
}

export const TIER_THRESHOLDS: TierThreshold[] = [
  { name: 'Tin', minRating: 720, color: '#78716c' },
  { name: 'Bronze', minRating: 910, color: '#b45309' },
  { name: 'Silver', minRating: 1130, color: '#94a3b8' },
  { name: 'Gold', minRating: 1390, color: '#eab308' },
  { name: 'Platinum', minRating: 1680, color: '#a78bfa' },
  { name: 'Diamond', minRating: 2000, color: '#60a5fa' },
]

export interface RatingHistoryEntry {
  rating: number
  peakRating: number
  tier: string | null
  games: number
  wins: number
  recordedAt: string | Date
}

export interface ChartPoint extends RatingHistoryEntry {
  date: string
  timestamp: number
}

export function prepareChartData(history: RatingHistoryEntry[]): ChartPoint[] {
  return [...history]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map((entry) => {
      const ts = new Date(entry.recordedAt)
      return {
        ...entry,
        date: formatDate(ts),
        timestamp: ts.getTime(),
      }
    })
}

export function getCurrentSeason(now: Date, seasons: SeasonDef[] = SEASONS): SeasonDef {
  const sorted = [...seasons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  let current = sorted[0]
  for (const season of sorted) {
    if (season.startsAt.getTime() <= now.getTime()) {
      current = season
    } else {
      break
    }
  }
  return current
}

export function getTierFromRating(rating: number): string {
  const sorted = [...TIER_THRESHOLDS].sort((a, b) => a.minRating - b.minRating)
  let tier = sorted[0]
  for (const t of sorted) {
    if (rating >= t.minRating) tier = t
  }
  return tier.name
}
