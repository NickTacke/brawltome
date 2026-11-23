import type { EsportsProfile, EsportsResult } from './profile'

const highlightCount = 4
// a highlight is a finish worth leading with; below top 8 a result only goes in the row of the rest
const highlightCutoff = 8

function bestFirst(left: EsportsResult, right: EsportsResult): number {
  return left.placement - right.placement || right.startTime - left.startTime
}

/** The results the section leads with as large cards: the four best top-8 finishes, the newer first on a tie. */
export function pickHighlights(results: EsportsResult[]): EsportsResult[] {
  const topEight = results.filter((result) => result.placement <= highlightCutoff)

  return topEight.sort(bestFirst).slice(0, highlightCount)
}

/** The events that lead the All, 1v1 and 2v2 filters, each listed once. */
export function highlightTournamentIds(profile: EsportsProfile): string[] {
  const filters = [
    profile.results,
    profile.results.filter((result) => result.mode === '1v1'),
    profile.results.filter((result) => result.mode === '2v2'),
  ]

  const tournamentIds = filters.flatMap((results) => pickHighlights(results).map((result) => result.tournamentId))

  return [...new Set(tournamentIds)]
}
