import type { LeaderboardEntry } from '@brawltome/contracts'
import type { ReactNode } from 'react'
import { PlayerTableHead, playerColumnCount } from '../home/PlayerTableHead'
import { RankedTable, TableMessage } from '../home/RankedTable'
import { TopPlayerRow } from '../home/TopPlayerRow'
import { TopPlayerSkeleton } from '../home/TopPlayerSkeleton'
import { rankWidthStyle } from '../page-number'
import { RankingPager, RankingTopPager } from '../RankingPager'
import type { RankedPage } from '../ranked-page'
import { rankingPageStyle } from '../rankings-layout'
import { LeaderboardHeader } from './LeaderboardHeader'
import { lastLeaderboardPage } from './leaderboard-search'

const defaultPageSize = 30

type LeaderboardBoardProps = {
  // null when the board couldn't be read
  board: RankedPage<LeaderboardEntry> | null
  page: number
  filters: ReactNode
  isLoading: boolean
  avatarCount: number
  onPage: (page: number) => void
}

type TableBodyProps = Omit<LeaderboardBoardProps, 'filters' | 'onPage'> & { rankWidth: string }

function TableBody({ board, page, isLoading, avatarCount, rankWidth }: TableBodyProps) {
  if (isLoading) {
    return <TopPlayerSkeleton avatarCount={avatarCount} rowCount={defaultPageSize} rankWidthStyle={rankWidth} />
  }

  if (board === null) return <TableMessage columnCount={playerColumnCount} text="The leaderboard couldn't be loaded" />

  if (board.totalRows === 0) return <TableMessage columnCount={playerColumnCount} text="Nobody on this board yet" />

  if (board.entries.length === 0) {
    return <TableMessage columnCount={playerColumnCount} text={`Page ${page} is past the end of this board`} />
  }

  return board.entries.map((entry) => <TopPlayerRow key={entry.standing} entry={entry} rankWidthStyle={rankWidth} />)
}

export function LeaderboardBoard({ board, page, filters, isLoading, avatarCount, onPage }: LeaderboardBoardProps) {
  const pageSize = board?.pageSize ?? defaultPageSize
  const rankWidth = rankWidthStyle(page * pageSize)

  const pager = board && (
    <RankingTopPager
      label="Leaderboard"
      page={page}
      totalRows={board.totalRows}
      pageSize={pageSize}
      lastPage={lastLeaderboardPage}
      onPage={onPage}
    />
  )

  return (
    <div className={rankingPageStyle}>
      <LeaderboardHeader tab="Players" filters={filters} pager={pager} />
      <RankedTable head={<PlayerTableHead rankWidthStyle={rankWidth} />}>
        <TableBody board={board} page={page} isLoading={isLoading} avatarCount={avatarCount} rankWidth={rankWidth} />
      </RankedTable>
      {board && (
        <RankingPager
          label="Leaderboard"
          page={page}
          totalRows={board.totalRows}
          pageSize={pageSize}
          lastPage={lastLeaderboardPage}
          onPage={onPage}
        />
      )}
    </div>
  )
}
