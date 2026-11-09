import type { LeaderboardEntry } from '@brawltome/contracts'
import type { ReactNode } from 'react'
import { columnLabelStyle, RankedTable, statHeaderStyle, TableMessage } from './RankedTable'
import { SectionHeader, viewAllStyle } from './SectionHeader'
import { TopPlayerRow } from './TopPlayerRow'
import { TopPlayerSkeleton } from './TopPlayerSkeleton'

const columnCount = 6

type TopPlayersProps = {
  // null when the board couldn't be read
  entries: LeaderboardEntry[] | null
  filters: ReactNode
  isLoading: boolean
  avatarCount: number
}

function TableHead() {
  return (
    <>
      <th scope="col" className={`w-12 pr-1 text-left ${columnLabelStyle}`}>
        #
      </th>
      <th scope="col" className={`pl-0 text-left ${columnLabelStyle}`}>
        Player
      </th>
      <th scope="col" className={`w-20 pl-2 text-right sm:pr-2 ${columnLabelStyle}`}>
        Rating
      </th>
      <th scope="col" className={`w-16 ${statHeaderStyle}`}>
        Peak
      </th>
      <th scope="col" className={`w-20 ${statHeaderStyle}`}>
        Win rate
      </th>
      <th scope="col" className={`w-16 ${statHeaderStyle} sm:pr-3`}>
        Games
      </th>
    </>
  )
}

function TableBody({ entries, isLoading, avatarCount }: Omit<TopPlayersProps, 'filters'>) {
  if (isLoading) return <TopPlayerSkeleton avatarCount={avatarCount} />

  if (entries === null) return <TableMessage columnCount={columnCount} text="The leaderboard couldn't be loaded" />

  if (entries.length === 0) return <TableMessage columnCount={columnCount} text="Nobody on this board yet" />

  return entries.map((entry) => <TopPlayerRow key={entry.standing} entry={entry} />)
}

export function TopPlayers({ entries, filters, isLoading, avatarCount }: TopPlayersProps) {
  // the leaderboard page isn't built yet, a plain link keeps working once it is
  const viewAll = (
    <a href="/leaderboard" className={viewAllStyle}>
      View all →
    </a>
  )

  return (
    <section className="min-w-0">
      <SectionHeader
        title="Top players"
        action={
          <div className="flex w-full items-center justify-between gap-5 sm:w-auto sm:justify-end">
            {filters}
            {viewAll}
          </div>
        }
      />
      <RankedTable head={<TableHead />}>
        <TableBody entries={entries} isLoading={isLoading} avatarCount={avatarCount} />
      </RankedTable>
    </section>
  )
}
