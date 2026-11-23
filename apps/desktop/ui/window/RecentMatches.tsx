import { LegendPortrait } from '../overlay/CardHead'
import { signedChange } from '../overlay/post-match'
import type { RecentMatch } from './app-status'
import { timeAgo } from './status-format'

type RecentMatchesProps = { matches: RecentMatch[]; nowMs: number; onOpenProfile: (brawlhallaId: number) => void }

const GHOST_ROW_COUNT = 4

export function RecentMatches({ matches, nowMs, onOpenProfile }: RecentMatchesProps) {
  return (
    <section className="recent">
      <h2 className="section-title">Recent matches</h2>
      {matches.length === 0 ? (
        <NoMatches />
      ) : (
        <div className="matches">
          {matches.map((recentMatch) => (
            <MatchRow
              key={recentMatch.startedAtMs}
              recentMatch={recentMatch}
              nowMs={nowMs}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </div>
      )}
    </section>
  )
}

type MatchRowProps = { recentMatch: RecentMatch; nowMs: number; onOpenProfile: (brawlhallaId: number) => void }

// the result and the elo change are drawn once the app has read them from the results screen
function MatchRow({ recentMatch, nowMs, onOpenProfile }: MatchRowProps) {
  const { opponents, isWin, ratingChange } = recentMatch
  const [firstOpponent] = opponents
  const names = opponents.map((opponent) => opponent.name).join(' + ')

  const openProfile = () => {
    if (firstOpponent !== undefined) onOpenProfile(firstOpponent.brawlhallaId)
  }

  return (
    <button type="button" className="match" onClick={openProfile}>
      {isWin === null ? <span className="result-slot" /> : <ResultTag isWin={isWin} />}
      <LegendPortrait legend={firstOpponent?.legend ?? null} isSmall />
      <span className="opponents">
        {names}
        {opponents.length > 1 && <small>2v2</small>}
      </span>
      {ratingChange === null ? <span /> : <RatingChange change={ratingChange} />}
      <span className="when">{timeAgo(recentMatch.startedAtMs, nowMs)}</span>
    </button>
  )
}

function ResultTag({ isWin }: { isWin: boolean }) {
  return isWin ? <span className="tag won">W</span> : <span className="tag lost">L</span>
}

function RatingChange({ change }: { change: number }) {
  return <span className={`change ${change < 0 ? 'down' : 'up'}`}>{signedChange(change)}</span>
}

// the list's shape, faded, so the first start shows where matches will land
function NoMatches() {
  const ghostRows = Array.from({ length: GHOST_ROW_COUNT }, (_, index) => index)

  return (
    <div className="matches is-empty">
      {ghostRows.map((index) => (
        <span className="ghost-row" key={index}>
          <span className="ghost-block tag-block" />
          <span className="ghost-block portrait-block" />
          <span className="ghost-block name-block" />
        </span>
      ))}
      <span className="empty-note">No matches yet</span>
    </div>
  )
}
