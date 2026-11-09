import { formatGrouped, winPercent, winRateColour } from './player-format'
import { WinBar, WinRateLabel } from './WinBar'

type SplitRecordProps = { standing: { wins: number; games: number }; emptyText?: string }

export function SplitRecord({ standing, emptyText = 'No ranked games this season' }: SplitRecordProps) {
  if (standing.games === 0) return <p className="text-sm text-soft">{emptyText}</p>

  const percent = winPercent(standing.wins, standing.games)

  return (
    <div>
      <WinBar wins={standing.wins} games={standing.games} />
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] gap-x-2 font-mono text-sm whitespace-nowrap text-soft">
        <span>{formatGrouped(standing.wins)}W</span>
        <span className={`text-center font-bold ${winRateColour(percent)}`}>
          <WinRateLabel /> {percent.toFixed(1)}%
        </span>
        <span className="text-right">{formatGrouped(standing.games - standing.wins)}L</span>
      </div>
    </div>
  )
}
