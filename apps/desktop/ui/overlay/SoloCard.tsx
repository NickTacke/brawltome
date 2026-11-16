import type { ReactNode } from 'react'
import { BannerSlot, CardHead } from './CardHead'
import { failureText, formatCount, tierLabel, winRateClass, winRatePercent } from './card-format'
import type { CardData, PlayerHead } from './overlay-view'
import { RetryRow, retryCountdown } from './RetryRow'

type Ranked = Extract<CardData, { state: 'ranked' }>
type SubPart = { key: string; content: ReactNode }

type SoloCardProps = {
  player: PlayerHead
  data: CardData
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

export function SoloCard({ player, data, onOpenProfile, onRetry }: SoloCardProps) {
  // the profile link doesn't need the lookup, so the head stays clickable beside the retry button
  if (data.state === 'failed') {
    return (
      <div className="card">
        <BannerSlot tier={null} />
        <span className="main">
          <button type="button" className="card-link" onClick={() => onOpenProfile(player.brawlhallaId)}>
            <CardHead name={player.name} legend={player.legend} sub={failureText(data.reason)} isBusy={false} />
          </button>
          <RetryRow note={retryCountdown(data.retryInSeconds)} canRetry={data.canRetry} onRetry={onRetry} />
        </span>
      </div>
    )
  }

  const isBusy = data.state === 'loading' || (data.state === 'ranked' && data.isRefreshing)
  const tier = data.state === 'ranked' ? data.tier : null

  return (
    <button type="button" className={cardClass(data)} onClick={() => onOpenProfile(player.brawlhallaId)}>
      <BannerSlot tier={tier} />
      <span className="main">
        <CardHead name={player.name} legend={player.legend} sub={subLine(data)} isBusy={isBusy} />
        {data.state === 'loading' && <PlaceholderFigures />}
        {data.state === 'ranked' && <RankedFigures data={data} />}
      </span>
    </button>
  )
}

function cardClass(data: Exclude<CardData, { state: 'failed' }>): string {
  if (data.state === 'loading') return 'card is-loading'

  if (data.state === 'ranked' && data.isRefreshing) return 'card is-refreshing'

  return 'card'
}

function subLine(data: Exclude<CardData, { state: 'failed' }>): ReactNode {
  if (data.state === 'loading') return <span className="bar sub-bar" />

  if (data.state === 'noRankedData') return 'No ranked data'

  return <SubParts parts={rankedSubParts(data)} />
}

// tier and rank when known, never a region
function rankedSubParts(data: Ranked): SubPart[] {
  const parts: SubPart[] = []

  if (data.tier !== null) parts.push({ key: 'tier', content: tierLabel(data.tier) })

  if (data.regionRank !== null) parts.push({ key: 'rank', content: <b>{`#${data.regionRank}`}</b> })

  return parts
}

function SubParts({ parts }: { parts: SubPart[] }) {
  return parts.map((part, index) => (
    <span key={part.key}>
      {index > 0 && <span className="dot">·</span>}
      {part.content}
    </span>
  ))
}

// the Elo and the peak read as one figure, the win rate beside it
function RankedFigures({ data }: { data: Ranked }) {
  return (
    <span className="figures">
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{data.rating}</span>
          <span className="peak">{`/ ${data.peakRating}`}</span>
        </span>
        <span className="stat-label">Elo / peak</span>
      </span>
      <WinRate wins={data.wins} games={data.games} />
    </span>
  )
}

// the win rate over the season's games, with the game count as its label
function WinRate({ wins, games }: { wins: number; games: number }) {
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

function PlaceholderFigures() {
  return (
    <span className="figures placeholder">
      <span className="stat">
        <span className="bar lead" />
        <span className="bar label-bar" />
      </span>
      <span className="stat">
        <span className="bar" />
        <span className="bar label-bar" />
      </span>
    </span>
  )
}
