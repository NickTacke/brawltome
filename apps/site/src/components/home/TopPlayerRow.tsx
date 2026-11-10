import type { LeaderboardEntry } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import { fixEncoding, formatWhole } from '../../lib'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { tierName, winPercent, winRateColour } from '../player/player-format'
import { stripedTallRowStyle } from '../table-styles'
import { entryPlayers } from './entry-players'
import { nameLinkStyle, Place, statCellStyle } from './RankedTable'

function WinRate({ entry }: { entry: LeaderboardEntry }) {
  const cellStyle = 'hidden w-20 px-2 text-right font-mono font-bold sm:table-cell'

  if (entry.games === 0) return <td className={`${cellStyle} text-soft`}>—</td>

  const percent = winPercent(entry.wins, entry.games)

  return <td className={`${cellStyle} ${winRateColour(percent)}`}>{percent.toFixed(1)}%</td>
}

function Avatars({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="flex shrink-0 gap-1">
      {entryPlayers(entry).map((player) => (
        <div key={player.brawlhallaId} className="size-9 overflow-hidden rounded-md bg-raised">
          <img
            src={legendAvatarUrl(player.bestLegendNameKey ?? null)}
            alt=""
            className="size-full object-cover object-top"
          />
        </div>
      ))}
    </div>
  )
}

function NameAndTier({ entry }: { entry: LeaderboardEntry }) {
  const players = entryPlayers(entry)
  const name = players.map((player) => fixEncoding(player.name)).join(' & ')

  return (
    <div className="min-w-0 flex-1">
      {/* a full leaderboard page has thirty rows, and each preloaded player page is six internal reads */}
      <Link
        to="/player/$id"
        params={{ id: String(players[0].brawlhallaId) }}
        preload={false}
        title={name}
        className={nameLinkStyle}
      >
        {name}
      </Link>
      <div className="mt-0.5 truncate text-xs text-soft">
        {entry.region} · {tierName(entry.tier)}
      </div>
    </div>
  )
}

type TopPlayerRowProps = { entry: LeaderboardEntry; rankWidthStyle?: string }

export function TopPlayerRow({ entry, rankWidthStyle }: TopPlayerRowProps) {
  const peakRating = entry.peakRating === null ? '—' : formatWhole(entry.peakRating)

  return (
    <tr className={stripedTallRowStyle}>
      <Place place={entry.standing} widthStyle={rankWidthStyle} />
      <td className="max-w-0 pr-3">
        <div className="flex items-center gap-3">
          <Avatars entry={entry} />
          <NameAndTier entry={entry} />
        </div>
      </td>
      <td className="w-20 pr-3 pl-2 text-right font-mono font-semibold text-strong sm:pr-2">
        {formatWhole(entry.rating)}
      </td>
      <td className={`w-16 ${statCellStyle}`}>{peakRating}</td>
      <WinRate entry={entry} />
      <td className={`w-16 ${statCellStyle} sm:pr-3`}>{formatWhole(entry.games)}</td>
    </tr>
  )
}
