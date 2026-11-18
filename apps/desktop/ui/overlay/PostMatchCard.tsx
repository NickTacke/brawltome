import type { ReactNode } from 'react'
import { BannerSlot, LegendPortrait, Spinner } from './CardHead'
import { tierLabel } from './card-format'
import type { PlayerHead } from './overlay-view'
import { type MatchPageState, type PostMatchView, signedChange } from './post-match'

type PostMatchCardProps = { match: PostMatchView; onOpenMatchPage: () => void }

// the result first, then what it did to the elo; the banner is already the new tier. Once the match page is ready
// the whole card opens it, and its last row says so
export function PostMatchCard({ match, onOpenMatchPage }: PostMatchCardProps) {
  const content = (
    <>
      <BannerSlot tier={match.tier} />
      <span className="main">
        <span className="head result-head">
          <OpponentPortraits opponents={match.opponents} />
          <span className={match.isWin ? 'result won' : 'result lost'}>{match.isWin ? 'Won' : 'Lost'}</span>
          <span className="versus">
            <span>vs</span>
            <span className="opponent-names">{match.opponents.map((opponent) => opponent.name).join(' + ')}</span>
          </span>
        </span>
        <span className="figures">
          <span className="stat">
            <span className="stat-value">
              <span className="elo-before">{`${match.rating - match.ratingChange} →`}</span>
              <span className="elo">{match.rating}</span>
              <Change change={match.ratingChange} />
            </span>
            <span className="stat-label">{match.opponents.length > 1 ? 'Team Elo' : 'Elo'}</span>
          </span>
        </span>
        <SecondRow match={match} />
        {match.matchPage !== null && <MatchPageRow state={match.matchPage} />}
      </span>
    </>
  )

  if (match.matchPage !== 'ready') return <div className="card post-match">{content}</div>

  return (
    <button type="button" className="card post-match" onClick={onOpenMatchPage}>
      {content}
    </button>
  )
}

const matchPageTexts: Record<MatchPageState, string> = {
  uploading: 'Uploading replay',
  building: 'Building match page',
  ready: 'Match page',
}

function MatchPageRow({ state }: { state: MatchPageState }): ReactNode {
  return (
    <span className={state === 'ready' ? 'match-row is-ready' : 'match-row'}>
      <span>{matchPageTexts[state]}</span>
      {state === 'ready' ? <span className="arrow">→</span> : <Spinner />}
    </span>
  )
}

function Change({ change }: { change: number }) {
  return <span className={change < 0 ? 'change down' : 'change up'}>{signedChange(change)}</span>
}

// a new tier is the news when there is one; in a 2v2 the player's own elo comes next. It gets its own row, since
// the elo above already takes the card's width
function SecondRow({ match }: { match: PostMatchView }) {
  if (match.tierChange !== null && match.tier !== null) {
    return (
      <span className="second-row">
        <span>{match.tierChange === 'up' ? 'Up a tier' : 'Down a tier'}</span>
        <span className={`second-value tier-${match.tierChange}`}>{tierLabel(match.tier)}</span>
      </span>
    )
  }

  if (match.personal2v2 === null) return null

  const { rating, change } = match.personal2v2

  return (
    <span className="second-row">
      <span>Your 2v2 Elo</span>
      <span className="second-value">
        {`${rating - change} → ${rating}`}
        <Change change={change} />
      </span>
    </span>
  )
}

function OpponentPortraits({ opponents }: { opponents: PlayerHead[] }) {
  const [first, second] = opponents

  if (second === undefined) return <LegendPortrait legend={first?.legend ?? null} />

  return (
    <span className="portrait-pair">
      <LegendPortrait legend={first?.legend ?? null} isSmall />
      <LegendPortrait legend={second.legend} isSmall />
    </span>
  )
}
