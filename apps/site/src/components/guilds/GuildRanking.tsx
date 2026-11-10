import type { RankedGuild } from '../../server/load-guild-ranking'
import { GuildRow, GuildTableHead, guildColumnCount } from '../home/GuildColumns'
import { RankedTable, TableMessage } from '../home/RankedTable'
import { rankWidthStyle } from '../page-number'
import { RankingPageHeader } from '../RankingPageHeader'
import { RankingPager } from '../RankingPager'
import type { RankedPage } from '../ranked-page'
import { rankingPageStyle } from '../rankings-layout'
import { lastGuildRankingPage } from './guild-ranking-search'

const defaultPageSize = 30

type GuildRankingProps = {
  // null when the ranking couldn't be read
  ranking: RankedPage<RankedGuild> | null
  page: number
  onPage: (page: number) => void
}

type TableBodyProps = Omit<GuildRankingProps, 'onPage'> & { rankWidth: string }

function TableBody({ ranking, page, rankWidth }: TableBodyProps) {
  if (ranking === null) {
    return <TableMessage columnCount={guildColumnCount} text="The guild ranking couldn't be loaded" />
  }

  if (ranking.totalRows === 0) return <TableMessage columnCount={guildColumnCount} text="No ranked guilds yet" />

  if (ranking.entries.length === 0) {
    return <TableMessage columnCount={guildColumnCount} text={`Page ${page} is past the end of the ranking`} />
  }

  // an unranked guild takes its place on the page
  const firstPlace = (page - 1) * ranking.pageSize + 1

  return ranking.entries.map((guild, index) => (
    <GuildRow key={guild.clanId} guild={guild} place={firstPlace + index} rankWidthStyle={rankWidth} />
  ))
}

export function GuildRanking({ ranking, page, onPage }: GuildRankingProps) {
  const pageSize = ranking?.pageSize ?? defaultPageSize
  const rankWidth = rankWidthStyle(page * pageSize)

  return (
    <div className={rankingPageStyle}>
      <RankingPageHeader title="Guilds" />
      <RankedTable head={<GuildTableHead rankWidthStyle={rankWidth} />}>
        <TableBody ranking={ranking} page={page} rankWidth={rankWidth} />
      </RankedTable>
      {ranking && (
        <RankingPager
          label="Guilds"
          page={page}
          totalRows={ranking.totalRows}
          pageSize={pageSize}
          lastPage={lastGuildRankingPage}
          onPage={onPage}
        />
      )}
    </div>
  )
}
