import type { TopGuild } from '../../server/load-top-guilds'
import { GuildRow, GuildTableHead, guildColumnCount } from './GuildColumns'
import { RankedTable, TableMessage } from './RankedTable'
import { SectionHeader } from './SectionHeader'

function TableBody({ guilds }: { guilds: TopGuild[] | null }) {
  if (guilds === null) {
    return <TableMessage columnCount={guildColumnCount} text="The guild ranking couldn't be loaded" />
  }

  if (guilds.length === 0) return <TableMessage columnCount={guildColumnCount} text="No ranked guilds yet" />

  return guilds.map((guild, index) => <GuildRow key={guild.clanId} guild={guild} place={index + 1} />)
}

// null when the ranking couldn't be read
export function TopGuilds({ guilds }: { guilds: TopGuild[] | null }) {
  return (
    <section className="min-w-0 border-t border-line/50 pt-8 xl:border-t-0 xl:pt-0">
      {/* "view all" comes back with the guilds page */}
      <SectionHeader title="Top guilds" />
      <RankedTable head={<GuildTableHead />}>
        <TableBody guilds={guilds} />
      </RankedTable>
    </section>
  )
}
