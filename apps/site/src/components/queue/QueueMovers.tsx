import type { LeaderboardRecentActivityEntry } from '@brawltome/contracts'
import type { ReactNode } from 'react'
import { sectionTitleStyle } from '../guild/guild-styles'
import { Avatars, PlayerNames, rowKey } from './QueuePlayers'
import { changeColour, formatChange } from './queue-format'

type Entry = LeaderboardRecentActivityEntry
type Movers = { climbers: Entry[]; drops: Entry[]; mostGames: Entry[] }

function ratingChange(entry: Entry) {
  return <span className={changeColour(entry.ratingDelta)}>{formatChange(entry.ratingDelta)}</span>
}

function gamesPlayed(entry: Entry) {
  return <span className="font-semibold text-strong">{entry.gamesDelta}</span>
}

type MoverListProps = { title: string; entries: Entry[]; value: (entry: Entry) => ReactNode }

function MoverList({ title, entries, value }: MoverListProps) {
  if (entries.length === 0) return null

  return (
    <section className="min-w-0">
      <h2 className={sectionTitleStyle}>{title}</h2>
      <ul className="mt-2.5">
        {entries.map((entry) => (
          <li
            key={rowKey(entry)}
            className="group relative flex h-[2.625rem] items-center gap-3 border-b border-line/25 text-sm last:border-b-0"
          >
            <Avatars row={entry} />
            <div className="min-w-0 flex-1">
              <PlayerNames row={entry} />
            </div>
            <span className="shrink-0 font-mono text-soft">
              {entry.winsDelta}W {entry.lossesDelta}L
            </span>
            <span className="w-10 shrink-0 text-right font-mono">{value(entry)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const columnStyle = 'divide-y divide-line/70 [&>*]:py-7 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0'

// short windows drop the last list, so the sticky column never runs past the bottom of the screen
const lastListStyle = '[@media(max-height:939px)]:hidden'

export function QueueMovers({ climbers, drops, mostGames }: Movers) {
  return (
    <div className={columnStyle}>
      <MoverList title="Biggest climbers" entries={climbers} value={ratingChange} />
      <MoverList title="Biggest drops" entries={drops} value={ratingChange} />
      {mostGames.length > 0 && (
        <div className={lastListStyle}>
          <MoverList title="Most games" entries={mostGames} value={gamesPlayed} />
        </div>
      )}
    </div>
  )
}

const skeletonFill = 'animate-pulse rounded-sm bg-white/[0.06]'
const skeletonNameWidths = ['w-32', 'w-24', 'w-28', 'w-20', 'w-36']

function MoverListSkeleton({ title }: { title: string }) {
  return (
    <section className="min-w-0">
      <h2 className={sectionTitleStyle}>{title}</h2>
      <ul className="mt-2.5">
        {skeletonNameWidths.map((nameWidth) => (
          <li key={nameWidth} className="flex h-[2.625rem] items-center gap-3">
            <span className={`size-7 shrink-0 ${skeletonFill}`} />
            <span className={`h-3 ${nameWidth} ${skeletonFill}`} />
            <span className={`ml-auto h-3 w-16 ${skeletonFill}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function QueueMoversSkeleton() {
  return (
    <div className={columnStyle}>
      <MoverListSkeleton title="Biggest climbers" />
      <MoverListSkeleton title="Biggest drops" />
      <div className={lastListStyle}>
        <MoverListSkeleton title="Most games" />
      </div>
    </div>
  )
}
