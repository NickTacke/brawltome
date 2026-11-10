import { Link } from '@tanstack/react-router'
import { fixEncoding, formatWhole } from '../../lib'
import type { TopGuild } from '../../server/load-top-guilds'
import { stripedTallRowStyle } from '../table-styles'
import { columnLabelStyle, nameLinkStyle, Place, statCellStyle, statHeaderStyle } from './RankedTable'

export const guildColumnCount = 5

type GuildRowProps = { guild: TopGuild; place: number; rankWidthStyle?: string }

export function GuildRow({ guild, place, rankWidthStyle }: GuildRowProps) {
  const guildPoints = guild.guildPoints === null ? '—' : formatWhole(guild.guildPoints)

  return (
    <tr className={stripedTallRowStyle}>
      <Place place={guild.rank ?? place} widthStyle={rankWidthStyle} />
      <td className="max-w-0 pr-3">
        {/* a full ranking page has thirty rows, and each preloaded guild page is several internal reads */}
        <Link to="/guild/$id" params={{ id: String(guild.clanId) }} preload={false} className={nameLinkStyle}>
          {fixEncoding(guild.clanName)}
        </Link>
      </td>
      <td className="w-28 pr-3 pl-2 text-right font-mono font-semibold text-strong sm:pr-2">{guildPoints}</td>
      <td className={`w-28 ${statCellStyle}`}>{formatWhole(guild.lifetimeXp)}</td>
      <td className={`w-20 ${statCellStyle} sm:pr-3`}>{formatWhole(guild.memberCount)}</td>
    </tr>
  )
}

export function GuildTableHead({ rankWidthStyle = 'w-12' }: { rankWidthStyle?: string }) {
  return (
    <>
      <th scope="col" className={`${rankWidthStyle} pr-1 text-left ${columnLabelStyle}`}>
        #
      </th>
      <th scope="col" className={`pl-0 text-left ${columnLabelStyle}`}>
        Guild
      </th>
      <th scope="col" className={`w-28 pl-2 text-right sm:pr-2 ${columnLabelStyle}`}>
        Points
      </th>
      <th scope="col" className={`w-28 ${statHeaderStyle}`}>
        Lifetime XP
      </th>
      <th scope="col" className={`w-20 ${statHeaderStyle} sm:pr-3`}>
        Members
      </th>
    </>
  )
}
