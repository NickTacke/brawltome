import type { SeasonStartContract } from '@brawltome/contracts'
import { useMemo, useState } from 'react'
import { MobileCollapse } from './MobileCollapse'
import { formatGrouped } from './player-format'
import { RatingChart } from './RatingChart'
import { RecentMatches } from './RecentMatches'
import { type ChartPoint, type HistoryPoint, seasonsWithPoints } from './rating-seasons'
import { SeasonTiles } from './SeasonTiles'

const sectionTitle = 'flex h-9 items-center text-xl font-bold text-strong'

function SeasonLine({ points, isCurrent }: { points: ChartPoint[]; isCurrent: boolean }) {
  const first = points[0] as ChartPoint
  const last = points.at(-1) as ChartPoint
  const change = last.rating - first.rating

  const facts = [
    { label: 'Started', value: formatGrouped(first.rating) },
    { label: isCurrent ? 'Now' : 'Ended', value: formatGrouped(last.rating) },
  ]

  return (
    <div className="flex items-baseline gap-3 text-[0.8125rem] whitespace-nowrap text-soft tabular-nums">
      {facts.map(({ label, value }) => (
        <span key={label}>
          {label} <span className="font-black text-strong">{value}</span>
        </span>
      ))}
      <span className={`font-black ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {change >= 0 ? '+' : '−'}
        {formatGrouped(Math.abs(change))}
      </span>
    </div>
  )
}

type RatingHistoryProps = { history: HistoryPoint[]; seasonStarts: SeasonStartContract[] }

export function RatingHistory({ history, seasonStarts }: RatingHistoryProps) {
  const seasons = useMemo(() => seasonsWithPoints(history, seasonStarts), [history, seasonStarts])
  const [seasonId, setSeasonId] = useState(String(seasons[0]?.id ?? ''))
  const selected = seasons.find((season) => String(season.id) === seasonId)

  if (!selected) return null

  const isCurrent = selected.id === seasonStarts.at(-1)?.season
  const seasonLine = <SeasonLine points={selected.points} isCurrent={isCurrent} />

  return (
    <section aria-labelledby="rating-history">
      <MobileCollapse
        title="History"
        titleId="rating-history"
        titleClassName={sectionTitle}
        headerEnd={<div className="max-sm:hidden">{seasonLine}</div>}
        isHeaderEndHiddenWhenClosed
      >
        <SeasonTiles seasons={seasons} selectedId={seasonId} onSelect={setSeasonId} />
        <div className="mt-2 sm:hidden">{seasonLine}</div>
        <div className="mt-3 grid gap-x-8 gap-y-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(14rem,1fr)]">
          <RatingChart points={selected.points} heightClass="h-52" />
          <RecentMatches />
        </div>
      </MobileCollapse>
    </section>
  )
}
