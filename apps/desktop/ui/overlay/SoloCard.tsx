import type { ReactNode } from 'react'
import { BannerSlot, CardHead } from './CardHead'
import {
  failureText,
  formatCount,
  isInPlacement,
  knownTier,
  PLACEMENT_GAMES,
  shownPeak,
  tierLabel,
} from './card-format'
import type { CardData, Known, PlayerHead } from './overlay-view'
import { RetryRow, retryCountdown } from './RetryRow'
import { WinRate } from './WinRate'

type Ranked = Extract<CardData, { state: 'ranked' }>
type SubPart = { key: string; content: ReactNode }

type SoloCardProps = {
  player: PlayerHead
  known: Known | null
  data: CardData
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

// what the game's memory holds shows at once; the lookup adds the peak, the win rate and the region rank
export function SoloCard({ player, known, data, onOpenProfile, onRetry }: SoloCardProps) {
  // the profile link doesn't need the lookup, so the head stays clickable beside the retry button
  if (data.state === 'failed' && known === null) {
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

  const ranked = data.state === 'ranked' ? data : null
  const isBusy = (data.state === 'loading' && known === null) || ranked?.isRefreshing === true

  return (
    <button type="button" className={cardClass(data, known)} onClick={() => onOpenProfile(player.brawlhallaId)}>
      <BannerSlot tier={bannerTier(ranked, known)} />
      <span className="main">
        <CardHead name={player.name} legend={player.legend} sub={subLine(known, data)} isBusy={isBusy} />
        <Figures known={known} data={data} />
      </span>
    </button>
  )
}

function cardClass(data: CardData, known: Known | null): string {
  if (data.state === 'loading' && known === null) return 'card is-loading'

  if (data.state === 'ranked' && data.isRefreshing) return 'card is-refreshing'

  return 'card'
}

// the lookup's tier is the game's own, subdivision included; memory alone knows the base tier
function bannerTier(ranked: Ranked | null, known: Known | null): string | null {
  if (ranked !== null) return ranked.tier

  return known === null ? null : knownTier(known)
}

function subLine(known: Known | null, data: CardData): ReactNode {
  if (known === null && data.state === 'loading') return <span className="bar sub-bar" />

  if (known === null && data.state === 'noRankedData') return 'No ranked data'

  return <SubParts parts={subParts(known, data)} />
}

// placement or tier, then the region rank when known; never a region
function subParts(known: Known | null, data: CardData): SubPart[] {
  const parts: SubPart[] = []
  const ranked = data.state === 'ranked' ? data : null
  const tier = bannerTier(ranked, known)

  if (known !== null && isInPlacement(known)) {
    parts.push({ key: 'placement', content: `Placement ${known.games}/${PLACEMENT_GAMES}` })
  } else if (tier !== null) {
    parts.push({ key: 'tier', content: tierLabel(tier) })
  }

  if (ranked !== null && ranked.regionRank !== null) {
    parts.push({ key: 'rank', content: <b>{`#${ranked.regionRank}`}</b> })
  }

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

function Figures({ known, data }: { known: Known | null; data: CardData }) {
  if (data.state === 'ranked') return <RankedFigures data={data} rating={known?.rating ?? data.rating} />

  if (known === null) return data.state === 'loading' ? <PlaceholderFigures /> : null

  return <KnownFigures known={known} data={data} />
}

// the Elo and the peak read as one figure, the win rate beside it; memory's Elo is the live one
function RankedFigures({ data, rating }: { data: Ranked; rating: number }) {
  return (
    <span className="figures">
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{rating}</span>
          <span className="peak">{`/ ${shownPeak(rating, data.peakRating)}`}</span>
        </span>
        <span className="stat-label">Elo / peak</span>
      </span>
      <WinRate wins={data.wins} games={data.games} />
    </span>
  )
}

// the Elo and games from memory; while the lookup runs the peak and the win rate wait as bars, and a failed one
// says why where the win rate would be
function KnownFigures({ known, data }: { known: Known; data: Exclude<CardData, Ranked> }) {
  const isLoading = data.state === 'loading'
  const gamesText = `${formatCount(known.games)} ${known.games === 1 ? 'game' : 'games'}`

  return (
    <span className="figures">
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{known.rating}</span>
          {isLoading && <span className="bar peak-bar" />}
        </span>
        <span className="stat-label">{isLoading ? 'Elo / peak' : 'Elo'}</span>
      </span>
      <span className="stat">
        {isLoading ? <span className="bar rate-bar" /> : <span className="stat-value rate">—</span>}
        <span className="stat-label">{data.state === 'failed' ? failureText(data.reason) : gamesText}</span>
      </span>
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
