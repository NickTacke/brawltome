import type { LeaderboardIdentity } from '@brawltome/contracts'
import { fixEncoding } from '../../lib'
import { LegendAvatar } from '../guild/LegendAvatar'
import { PlayerLink } from '../guild/PlayerLink'
import { entryPlayers } from '../home/entry-players'

type Row = { identity: LeaderboardIdentity }

export function rowKey(row: Row): string {
  return entryPlayers(row)
    .map((player) => `${player.brawlhallaId}:${player.name}`)
    .join('&')
}

export function Avatars({ row }: { row: Row }) {
  return (
    <div className="flex shrink-0 gap-1">
      {entryPlayers(row).map((player) => (
        <LegendAvatar key={`${player.brawlhallaId}:${player.name}`} legend={player.bestLegendNameKey ?? null} />
      ))}
    </div>
  )
}

// a lone player's link covers the whole row, a team's two names each keep their own
export function PlayerNames({ row }: { row: Row }) {
  const players = entryPlayers(row)
  const isSolo = players.length === 1

  const linkStyle = isSolo
    ? 'transition-colors group-hover:text-primary after:absolute after:inset-0'
    : 'hover:text-primary'

  return (
    <span className="block truncate font-semibold text-strong">
      {players.map((player, index) => (
        <span key={`${player.brawlhallaId}:${player.name}`}>
          {index > 0 && <span className="font-normal text-soft"> &amp; </span>}
          <PlayerLink playerId={player.brawlhallaId} className={linkStyle}>
            {fixEncoding(player.name)}
          </PlayerLink>
        </span>
      ))}
    </span>
  )
}
