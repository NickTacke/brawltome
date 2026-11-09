import { bestRating, formatGrouped } from './player-format'
import { statLabel } from './player-styles'
import type { Standing } from './side-summary'

type RatingAndPeakProps = { standing: Standing; ratingClass: string; peakClass: string; labelClass?: string }

export function RatingAndPeak({ standing, ratingClass, peakClass, labelClass = '' }: RatingAndPeakProps) {
  const peak = bestRating(standing.rating, standing.peakRating)
  const isAtPeak = standing.rating >= peak

  return (
    <span className="flex shrink-0 items-baseline justify-end gap-x-1.5 whitespace-nowrap">
      <span className={`leading-none font-black tracking-tight text-strong ${ratingClass}`}>
        {formatGrouped(standing.rating)}
      </span>
      {!isAtPeak && <span className={`leading-none font-bold text-soft/70 ${peakClass}`}>/ {formatGrouped(peak)}</span>}
      <span className={`${statLabel} text-soft/70 ${isAtPeak ? '' : labelClass}`}>{isAtPeak ? 'At peak' : 'Peak'}</span>
    </span>
  )
}
