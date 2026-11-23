import { BannerSlot } from '../overlay/CardHead'
import { signedChange } from '../overlay/post-match'
import type { OwnStanding } from './app-status'
import { ownRankText, ownTier, type TodayResults } from './standing-format'

type StandingHeaderProps = { you: OwnStanding | null; today: TodayResults | null }

// the player's own banner and elo, drawn like the overlay cards; the game's memory fills it in the first ranked 1v1
export function StandingHeader({ you, today }: StandingHeaderProps) {
  if (you === null) return <WaitingHeader />

  return (
    <section className="standing">
      <BannerSlot tier={ownTier(you)} />
      <span className="standing-name">{you.name}</span>
      <span className="standing-sub">
        {ownRankText(you)}
        <span className="dot">·</span>1v1
      </span>
      <span className="standing-figure">
        <span className="elo">{you.rating}</span>
        <span className="figure-label">Elo</span>
      </span>
      {today !== null && <TodayLine today={today} />}
    </section>
  )
}

function WaitingHeader() {
  return (
    <section className="standing is-waiting">
      <BannerSlot tier={null} />
      <span className="standing-name">Waiting for Brawlhalla</span>
      <span className="standing-sub">Start the game</span>
      <span className="standing-figure">
        <span className="elo">— / —</span>
      </span>
    </section>
  )
}

function TodayLine({ today }: { today: TodayResults }) {
  const changeClass = today.ratingChange < 0 ? 'down' : 'up'

  return (
    <span className="today">
      Today<span className="dot">·</span>
      <span className="won">{today.wins}W</span> <span className="lost">{today.losses}L</span>
      <span className="dot">·</span>
      <span className={`today-change ${changeClass}`}>{signedChange(today.ratingChange)}</span>
    </span>
  )
}
