import type { PlayerRankedProfileContract, SeasonStartContract } from '@brawltome/contracts'

export type HistoryPoint = NonNullable<PlayerRankedProfileContract['snapshot']>['ratingHistory'][number]
export type ChartPoint = HistoryPoint & { time: number }
export type Season = { id: number; points: ChartPoint[] }

const minimumSeasonPoints = 2
const seasonTileCount = 4

/** The seasons a player has a line for, newest first. */
export function seasonsWithPoints(history: HistoryPoint[], seasonStarts: SeasonStartContract[]): Season[] {
  const points = history
    .map((point) => ({ ...point, time: Date.parse(point.recordedAt) }))
    .sort((left, right) => left.time - right.time)

  const seasons = seasonStarts.map(({ season, startsAt }, index) => {
    const startMs = Date.parse(startsAt)
    const nextStart = seasonStarts[index + 1]?.startsAt
    const endMs = nextStart ? Date.parse(nextStart) : Number.POSITIVE_INFINITY

    return { id: season, points: points.filter(({ time }) => time >= startMs && time < endMs) }
  })

  return seasons.filter((season) => season.points.length >= minimumSeasonPoints).reverse()
}

// the newest seasons stay as tiles and the rest live in one menu, so the row never grows or scrolls.
// an older pick takes the last tile, so its numbers are still on show
export function shownSeasons(seasons: Season[], selectedId: string): Season[] {
  const newest = seasons.slice(0, seasonTileCount)
  const selected = seasons.find((season) => String(season.id) === selectedId)

  if (!selected || newest.includes(selected)) return newest

  return [...newest.slice(0, seasonTileCount - 1), selected]
}

export function highestPoint(points: ChartPoint[]): ChartPoint {
  return points.reduce((best, point) => (point.rating >= best.rating ? point : best), points[0] as ChartPoint)
}

export function seasonTotals({ points }: Season) {
  const last = points.at(-1) as ChartPoint

  return {
    tier: highestPoint(points).tier,
    peak: Math.max(...points.map((point) => Math.max(point.rating, point.peakRating))),
    wins: last.wins,
    games: last.games,
  }
}
