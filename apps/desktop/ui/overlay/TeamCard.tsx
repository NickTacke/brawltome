import { BannerSlot, LegendPortrait, Spinner } from './CardHead'
import { baseTierFor, failureText, shownPeak, teamAverage } from './card-format'
import type { TeamData, TeamPlayer } from './overlay-view'
import { RetryRow, retryCountdown } from './RetryRow'
import { WinRate } from './WinRate'

type TeamCardProps = {
  data: TeamData
  players: TeamPlayer[]
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

// the people on top and the team's standing below, the same order as the 1v1 card
export function TeamCard({ data, players, onOpenProfile, onRetry }: TeamCardProps) {
  const estimate = data.state === 'ready' && data.standing === null ? teamAverage(players) : null

  return (
    <div className={teamCardClass(data)}>
      <BannerSlot tier={bannerTier(data, estimate)} />
      <span className="main">
        <span className="players">
          {players.map((player) => (
            <PlayerRow key={player.brawlhallaId} player={player} onOpenProfile={onOpenProfile} />
          ))}
        </span>
        <TeamFigures data={data} estimate={estimate} />
        {data.state === 'failed' && (
          <RetryRow note={retryCountdown(data.retryInSeconds)} canRetry={data.canRetry} onRetry={onRetry} />
        )}
      </span>
    </div>
  )
}

function teamCardClass(data: TeamData): string {
  if (data.state === 'loading') return 'card is-loading'

  if (data.state === 'ready' && data.isRefreshing) return 'card is-refreshing'

  return 'card'
}

function bannerTier(data: TeamData, estimate: number | null): string | null {
  if (data.state !== 'ready') return null

  if (data.standing !== null) return data.standing.tier

  return estimate === null ? null : baseTierFor(estimate)
}

type TeamFiguresProps = { data: TeamData; estimate: number | null }

function TeamFigures({ data, estimate }: TeamFiguresProps) {
  const isBusy = data.state === 'loading' || (data.state === 'ready' && data.isRefreshing)

  return (
    <span className="figures team-figures">
      <TeamStanding data={data} estimate={estimate} />
      {isBusy && <Spinner />}
    </span>
  )
}

// the team's elo, peak and win rate; the banner already says the tier. A team we hold no rating for shows the
// players' average, or a dash without it
function TeamStanding({ data, estimate }: TeamFiguresProps) {
  if (data.state === 'loading') {
    return (
      <span className="stat">
        <span className="bar lead" />
        <span className="bar label-bar" />
      </span>
    )
  }

  const standing = data.state === 'ready' ? data.standing : null

  if (standing === null && estimate !== null) {
    return (
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{estimate}</span>
        </span>
        <span className="stat-label">Team avg</span>
      </span>
    )
  }

  return (
    <>
      <span className="stat">
        <span className="stat-value">
          <span className="elo">{standing?.rating ?? '—'}</span>
          {standing !== null && <span className="peak">{`/ ${shownPeak(standing.rating, standing.peakRating)}`}</span>}
        </span>
        <span className="stat-label">{standingLabel(data, standing !== null)}</span>
      </span>
      {standing !== null && <WinRate wins={standing.wins} games={standing.games} />}
    </>
  )
}

type PlayerRowProps = { player: TeamPlayer; onOpenProfile: (brawlhallaId: number) => void }

function PlayerRow({ player, onOpenProfile }: PlayerRowProps) {
  return (
    <button type="button" className="player" onClick={() => onOpenProfile(player.brawlhallaId)}>
      <LegendPortrait legend={player.legend} isSmall />
      <span className="name">{player.name}</span>
      <PlayerRating player={player} />
    </button>
  )
}

// the personal 2v2 elo from the game's memory, else the player's 1v1 elo, marked so it isn't read as 2v2
function PlayerRating({ player }: { player: TeamPlayer }) {
  if (player.personalRating2v2 !== null) return <span className="rating">{player.personalRating2v2}</span>

  if (player.oneVsOneRating === null) return null

  return (
    <span className="rating">
      {player.oneVsOneRating}
      <span className="label">1v1</span>
    </span>
  )
}

// a failed lookup says why under the dash, the way the 1v1 card says it under the name
function standingLabel(data: TeamData, hasStanding: boolean): string {
  if (data.state === 'failed') return failureText(data.reason)

  return hasStanding ? 'Team Elo / peak' : '2v2 team'
}
