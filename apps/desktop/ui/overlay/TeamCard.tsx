import type { ReactNode } from 'react'
import { LegendPortrait, TierBanner } from './CardHead'
import { DEFERRED_PROFILE_TEXT, failureText } from './card-format'
import type { TeamData, TeamPlayer } from './overlay-view'
import { RetryRow, retryCountdown } from './RetryRow'

type TeamCardProps = {
  data: TeamData
  players: TeamPlayer[]
  deferredProfileIds: number[]
  timer: ReactNode
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

export function TeamCard({ data, players, deferredProfileIds, timer, onOpenProfile, onRetry }: TeamCardProps) {
  const isRefreshing = data.state === 'ready' && data.isRefreshing

  return (
    <div className={isRefreshing ? 'card is-refreshing' : 'card'}>
      {isRefreshing && <span className="refresh" />}
      <TeamHead data={data} />
      <span className="players">
        {players.map((player) => (
          <PlayerRow
            key={player.brawlhallaId}
            player={player}
            isDeferred={deferredProfileIds.includes(player.brawlhallaId)}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </span>
      {data.state === 'failed' && <RetryRow note={teamFailureNote(data)} canRetry={data.canRetry} onRetry={onRetry} />}
      {timer}
    </div>
  )
}

// a team card has no sub line, so the reason goes in the retry row
function teamFailureNote(data: Extract<TeamData, { state: 'failed' }>): string {
  const countdown = retryCountdown(data.retryInSeconds)
  const reason = failureText(data.reason)

  return countdown === null ? reason : `${reason} · ${countdown}`
}

function TeamHead({ data }: { data: TeamData }) {
  const standing = data.state === 'ready' ? data.standing : null

  return (
    <span className="team-head">
      {standing !== null && <TierBanner tier={standing.tier} />}
      {data.state === 'loading' ? (
        <span className="bar wide" />
      ) : (
        <span className="elo">{standing?.rating ?? '—'}</span>
      )}
      <span className="label">2v2 team</span>
    </span>
  )
}

type PlayerRowProps = { player: TeamPlayer; isDeferred: boolean; onOpenProfile: (brawlhallaId: number) => void }

function PlayerRow({ player, isDeferred, onOpenProfile }: PlayerRowProps) {
  return (
    <button type="button" className="player" onClick={() => onOpenProfile(player.brawlhallaId)}>
      <LegendPortrait legend={player.legend} isSmall />
      <span className="name">{player.name}</span>
      {isDeferred ? <span className="note">{DEFERRED_PROFILE_TEXT}</span> : <PlayerRating player={player} />}
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
