import type { ReactNode } from 'react'
import { CardHead } from './CardHead'
import { DEFERRED_PROFILE_TEXT, failureText, formatCount, tierLabel, winRateClass, winRatePercent } from './card-format'
import type { CardData, PlayerHead } from './overlay-view'
import { RetryRow, retryCountdown } from './RetryRow'

type Ranked = Extract<CardData, { state: 'ranked' }>
type SubPart = { key: string; content: ReactNode }

type SoloCardProps = {
  player: PlayerHead
  data: CardData
  isDeferred: boolean
  timer: ReactNode
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

export function SoloCard({ player, data, isDeferred, timer, onOpenProfile, onRetry }: SoloCardProps) {
  // the profile link doesn't need the lookup, so the head stays clickable beside the retry button
  if (data.state === 'failed') {
    return (
      <div className="card">
        <button type="button" className="card-link" onClick={() => onOpenProfile(player.brawlhallaId)}>
          <CardHead name={player.name} legend={player.legend} sub={failureText(data.reason)} tier={null} />
        </button>
        <RetryRow note={retryCountdown(data.retryInSeconds)} canRetry={data.canRetry} onRetry={onRetry} />
        {timer}
      </div>
    )
  }

  const isRefreshing = data.state === 'ranked' && data.isRefreshing
  const tier = data.state === 'ranked' ? data.tier : null
  const sub = isDeferred ? DEFERRED_PROFILE_TEXT : subLine(data)

  return (
    <button
      type="button"
      className={isRefreshing ? 'card is-refreshing' : 'card'}
      onClick={() => onOpenProfile(player.brawlhallaId)}
    >
      {isRefreshing && <span className="refresh" />}
      <CardHead name={player.name} legend={player.legend} sub={sub} tier={tier} />
      {data.state === 'loading' && <PlaceholderFigures />}
      {data.state === 'ranked' && <RankedFigures data={data} />}
      {timer}
    </button>
  )
}

function subLine(data: Exclude<CardData, { state: 'failed' }>): ReactNode {
  if (data.state === 'loading') return null

  if (data.state === 'noRankedData') return 'No ranked data'

  return <SubParts parts={rankedSubParts(data)} />
}

// tier and rank when known, never a region
function rankedSubParts(data: Ranked): SubPart[] {
  const parts: SubPart[] = []

  if (data.tier !== null) parts.push({ key: 'tier', content: tierLabel(data.tier) })

  if (data.regionRank !== null) parts.push({ key: 'rank', content: <b>{`#${data.regionRank}`}</b> })

  if (data.isRefreshing) parts.push({ key: 'updating', content: 'updating' })

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

function RankedFigures({ data }: { data: Ranked }) {
  return (
    <span className="figures">
      <span>
        <span className="elo">{data.rating}</span>
        <span className="peak">{`/ ${data.peakRating}`}</span> <span className="label">peak</span>
      </span>
      <GameRecord wins={data.wins} games={data.games} />
    </span>
  )
}

function GameRecord({ wins, games }: { wins: number; games: number }) {
  const percent = winRatePercent(wins, games)
  const gamesText = `${formatCount(games)} ${games === 1 ? 'game' : 'games'}`

  if (percent === null) return <span className="record">{gamesText}</span>

  return (
    <span className="record">
      <b className={winRateClass(percent)}>{`${percent}%`}</b>
      {` of ${gamesText}`}
    </span>
  )
}

function PlaceholderFigures() {
  return (
    <span className="figures placeholder">
      <span className="bar wide" />
      <span className="bar narrow" />
    </span>
  )
}
