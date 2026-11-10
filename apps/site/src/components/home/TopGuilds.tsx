import { Link } from '@tanstack/react-router'
import { fixEncoding, formatWhole } from '../../lib'
import type { TopGuild } from '../../server/load-top-guilds'
import { stripedTallRowStyle } from '../table-styles'
import {
  columnLabelStyle,
  nameLinkStyle,
  Place,
  RankedTable,
  statCellStyle,
  statHeaderStyle,
  TableMessage,
} from './RankedTable'
import { SectionHeader } from './SectionHeader'

const columnCount = 5

function GuildRow({ guild, place }: { guild: TopGuild; place: number }) {
  const guildPoints = guild.guildPoints === null ? '—' : formatWhole(guild.guildPoints)

  return (
    <tr className={stripedTallRowStyle}>
      <Place place={guild.rank ?? place} />
      <td className="max-w-0 pr-3">
        <Link to="/guild/$id" params={{ id: String(guild.clanId) }} className={nameLinkStyle}>
          {fixEncoding(guild.clanName)}
        </Link>
      </td>
      <td className="w-28 pr-3 pl-2 text-right font-mono font-semibold text-strong sm:pr-2">{guildPoints}</td>
      <td className={`w-28 ${statCellStyle}`}>{formatWhole(guild.lifetimeXp)}</td>
      <td className={`w-20 ${statCellStyle} sm:pr-3`}>{formatWhole(guild.memberCount)}</td>
    </tr>
  )
}

function TableHead() {
  return (
    <>
      <th scope="col" className={`w-12 pr-1 text-left ${columnLabelStyle}`}>
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

function TableBody({ guilds }: { guilds: TopGuild[] | null }) {
  if (guilds === null) return <TableMessage columnCount={columnCount} text="The guild ranking couldn't be loaded" />

  if (guilds.length === 0) return <TableMessage columnCount={columnCount} text="No ranked guilds yet" />

  return guilds.map((guild, index) => <GuildRow key={guild.clanId} guild={guild} place={index + 1} />)
}

// null when the ranking couldn't be read
export function TopGuilds({ guilds }: { guilds: TopGuild[] | null }) {
  return (
    <section className="min-w-0 border-t border-line/50 pt-8 xl:border-t-0 xl:pt-0">
      {/* "view all" comes back with the guilds page */}
      <SectionHeader title="Top guilds" />
      <RankedTable head={<TableHead />}>
        <TableBody guilds={guilds} />
      </RankedTable>
    </section>
  )
}
