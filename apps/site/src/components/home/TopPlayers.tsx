import type { LeaderboardEntry } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PlayerTableHead, playerColumnCount } from './PlayerTableHead'
import { RankedTable, TableMessage } from './RankedTable'
import { SectionHeader, viewAllStyle } from './SectionHeader'
import { TopPlayerRow } from './TopPlayerRow'
import { TopPlayerSkeleton } from './TopPlayerSkeleton'

type TopPlayersProps = {
  // null when the board couldn't be read
  entries: LeaderboardEntry[] | null
  filters: ReactNode
  isLoading: boolean
  avatarCount: number
}

function TableBody({ entries, isLoading, avatarCount }: Omit<TopPlayersProps, 'filters'>) {
  if (isLoading) return <TopPlayerSkeleton avatarCount={avatarCount} />

  if (entries === null) {
    return <TableMessage columnCount={playerColumnCount} text="The leaderboard couldn't be loaded" />
  }

  if (entries.length === 0) return <TableMessage columnCount={playerColumnCount} text="Nobody on this board yet" />

  return entries.map((entry) => <TopPlayerRow key={entry.standing} entry={entry} />)
}

export function TopPlayers({ entries, filters, isLoading, avatarCount }: TopPlayersProps) {
  // the leaderboard reads the same address, so it opens on the board picked here
  const viewAll = (
    <Link
      from="/"
      to="/leaderboard"
      search={(previous) => ({ mode: previous.mode, region: previous.region })}
      className={viewAllStyle}
    >
      View all →
    </Link>
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
      <RankedTable head={<PlayerTableHead />}>
        <TableBody entries={entries} isLoading={isLoading} avatarCount={avatarCount} />
      </RankedTable>
    </section>
  )
}
