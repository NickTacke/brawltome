import { BannerSlot, CardHead } from './CardHead'
import { formatCount, isInPlacement, knownTier, PLACEMENT_GAMES, tierLabel } from './card-format'
import type { Known, PlayerHead } from './overlay-view'

type TeammateCardProps = { player: PlayerHead; known: Known | null }

// a teammate the game matched at random, under the opponents' card, from the game's memory only
export function TeammateCard({ player, known }: TeammateCardProps) {
  const tier = known === null ? null : knownTier(known)

  return (
    <div className="card teammate-card">
      <BannerSlot tier={tier} />
      <span className="main">
        <CardHead name={player.name} legend={player.legend} sub={subLine(known, tier)} isBusy={false} />
        {known !== null && <TeammateFigures known={known} />}
      </span>
    </div>
  )
}

function subLine(known: Known | null, tier: string | null) {
  const parts = ['Your teammate']

  if (known !== null && isInPlacement(known)) parts.push(`Placement ${known.games}/${PLACEMENT_GAMES}`)
  else if (tier !== null) parts.push(tierLabel(tier))

  return parts.map((part, index) => (
    <span key={part} className={index === 0 ? 'teammate-lead' : undefined}>
      {index > 0 && <span className="dot">·</span>}
      {part}
    </span>
  ))
}

function TeammateFigures({ known }: { known: Known }) {
  return (
    <span className="figures">
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{known.rating}</span>
        </span>
        <span className="stat-label">Their 2v2 Elo</span>
      </span>
      <span className="stat">
        <span className="stat-value rate">{formatCount(known.games)}</span>
        <span className="stat-label">{known.games === 1 ? 'game' : 'games'}</span>
      </span>
    </span>
  )
}
