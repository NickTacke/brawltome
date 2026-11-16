import { formatCount, winRateClass, winRatePercent } from './card-format'

// the win rate over the season's games, with the game count as its label
export function WinRate({ wins, games }: { wins: number; games: number }) {
  const percent = winRatePercent(wins, games)
  const gamesText = `${formatCount(games)} ${games === 1 ? 'game' : 'games'}`
  const valueClass = percent === null ? 'stat-value rate' : `stat-value rate ${winRateClass(percent)}`

  return (
    <span className="stat">
      <span className={valueClass}>{percent === null ? '—' : `${percent}%`}</span>
      <span className="stat-label">{gamesText}</span>
    </span>
  )
}
