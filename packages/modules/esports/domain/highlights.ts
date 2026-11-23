import type { EsportsProfile, EsportsResult } from './profile'

const highlightCount = 4
// a highlight is a finish worth leading with; below top 8 a result only goes in the row of the rest
const highlightCutoff = 8
// the cards show how a player does now, so an old peak doesn't hold them for years
const recentWindowSeconds = 365 * 24 * 60 * 60

// a deeper run at a bigger event first, see importance.ts
function mostImportantFirst(left: EsportsResult, right: EsportsResult): number {
  return right.importance - left.importance || left.placement - right.placement || right.startTime - left.startTime
}

function newestFirst(left: EsportsResult, right: EsportsResult): number {
  return right.startTime - left.startTime || left.placement - right.placement
}

/**
 * The results the section leads with as large cards: the four top-8 finishes of the 365 days before `now` with the
 * highest importance, the better placement and then the newer first on a tie, and when fewer than four are that
 * recent, the newest older top 8s after them. The site picks them again from the importance this sends, in
 * `apps/site/src/components/player/esports/EsportsSection.tsx`, and the two must agree, or a card shows up whose sets
 * the refresh never fetched.
 */
export function pickHighlights(results: EsportsResult[], now: Date): EsportsResult[] {
  const recentSince = Math.floor(now.getTime() / 1000) - recentWindowSeconds
  const topEight = results.filter((result) => result.placement <= highlightCutoff)

  const recent = topEight.filter((result) => result.startTime >= recentSince).sort(mostImportantFirst)
  const older = topEight.filter((result) => result.startTime < recentSince).sort(newestFirst)

  return [...recent, ...older].slice(0, highlightCount)
}

/** The events that lead the All, 1v1 and 2v2 filters as of `now`, each listed once. */
export function highlightTournamentIds(profile: EsportsProfile, now: Date): string[] {
  const filters = [
    profile.results,
    profile.results.filter((result) => result.mode === '1v1'),
    profile.results.filter((result) => result.mode === '2v2'),
  ]

  const tournamentIds = filters.flatMap((results) => pickHighlights(results, now).map((result) => result.tournamentId))

  return [...new Set(tournamentIds)]
}
