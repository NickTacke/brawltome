import { timeAgo } from './utils'

/** Where a profile section's numbers came from: a V0 refresh, or the V1 leaderboard crawl. */
export type FreshnessSource = 'refresh' | 'leaderboard'

export interface SectionFreshness {
  at: string | Date
  source: FreshnessSource
}

type OneVsOneValues = { rating: number; peakRating: number; wins: number; games: number }

interface RankedProfileTimes {
  lastSuccessAt: string | null
  snapshot: { oneVsOne: OneVsOneValues } | null
}

interface LeaderboardObservation extends OneVsOneValues {
  observedAt: string
}

function validTime(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** A section drawn wholly from one V0 refresh: legends, teams, career stats. */
export function refreshFreshness(lastSuccessAt: string | Date | null | undefined): SectionFreshness | null {
  return lastSuccessAt && validTime(lastSuccessAt) !== null ? { at: lastSuccessAt, source: 'refresh' } : null
}

/**
 * When the 1v1 numbers were observed. Without a V0 snapshot they are the leaderboard standing itself. With one, the
 * API swaps in a leaderboard observation newer than the refresh; the ranked contract carries no time for that, so the
 * overlay is recognised by the standing being newer than the refresh and matching the shown numbers. Anything else
 * (no standing, an older one, or numbers from another source) is labelled with the refresh time.
 */
export function oneVsOneFreshness(
  currentSeason: RankedProfileTimes | null | undefined,
  standing: LeaderboardObservation | null | undefined,
): SectionFreshness | null {
  const snapshot = currentSeason?.snapshot
  if (!snapshot) return standing && validTime(standing.observedAt) !== null ? leaderboard(standing) : null

  const refreshed = refreshFreshness(currentSeason.lastSuccessAt)
  const observedAt = validTime(standing?.observedAt)
  const refreshedAt = validTime(currentSeason.lastSuccessAt)
  if (!standing || observedAt === null || (refreshedAt !== null && observedAt <= refreshedAt)) return refreshed

  const shown = snapshot.oneVsOne
  const overlaid =
    shown.rating === standing.rating &&
    shown.peakRating === standing.peakRating &&
    shown.wins === standing.wins &&
    shown.games === standing.games
  return overlaid ? leaderboard(standing) : refreshed
}

function leaderboard(standing: LeaderboardObservation): SectionFreshness {
  return { at: standing.observedAt, source: 'leaderboard' }
}

/**
 * The label parts: `prefix` from the sm breakpoint up and `compactPrefix` on phones, where a refresh label shows only
 * its age (screen readers still get the full prefix).
 */
export function freshnessLabel(freshness: SectionFreshness, now: Date = new Date()) {
  const age = timeAgo(freshness.at, now)
  return freshness.source === 'leaderboard'
    ? { prefix: 'From leaderboard', compactPrefix: 'Leaderboard', age }
    : { prefix: 'Updated', compactPrefix: null, age }
}
