import type { LeaderboardRecentActivityEntry } from '@brawltome/contracts'
import { formatWhole } from '../../lib'
import { columnLabelStyle } from '../home/RankedTable'
import { skeletonBarStyle, stripedRowStyle, stripedTableStyle } from '../table-styles'
import { Avatars, PlayerNames, rowKey } from './QueuePlayers'
import { QueueTicks } from './QueueTicks'
import { changeColour, formatChange } from './queue-format'

type Entry = LeaderboardRecentActivityEntry

function GamesRecord({ entry }: { entry: Entry }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[60px] shrink-0 font-mono whitespace-nowrap text-text">
        {entry.winsDelta}W <span className="text-soft">{entry.lossesDelta}L</span>
      </span>
      <QueueTicks wins={entry.winsDelta} losses={entry.lossesDelta} />
    </div>
  )
}

// on a phone the rank, region and record move under the name, and the change under the rating
function PlayerCell({ entry }: { entry: Entry }) {
  return (
    <td className="max-w-0 pr-3 pl-3 sm:pl-0">
      <div className="flex items-center gap-3">
        <Avatars row={entry} />
        <div className="min-w-0">
          <div className="text-base">
            <PlayerNames row={entry} />
          </div>
          <div className="mt-0.5 font-mono text-xs text-soft sm:hidden">
            #{formatWhole(entry.standing)} · {entry.region} · {entry.winsDelta}W {entry.lossesDelta}L
          </div>
        </div>
      </div>
    </td>
  )
}

function QueueRow({ entry }: { entry: Entry }) {
  const change = formatChange(entry.ratingDelta)
  const colour = changeColour(entry.ratingDelta)

  return (
    <tr className={stripedRowStyle}>
      <td className="hidden w-[76px] pr-3 pl-3 font-mono text-soft sm:table-cell">#{formatWhole(entry.standing)}</td>
      <PlayerCell entry={entry} />
      <td className="hidden w-20 px-3 text-soft sm:table-cell">{entry.region}</td>
      <td className="w-[108px] pr-3 pl-3 text-right font-mono font-semibold text-strong sm:w-24">
        {formatWhole(entry.rating)}
        <div className={`mt-0.5 text-xs font-normal sm:hidden ${colour}`}>{change}</div>
      </td>
      <td className={`hidden w-20 px-3 text-right font-mono sm:table-cell ${colour}`}>{change}</td>
      <td className="hidden w-[176px] pr-3 pl-3 sm:table-cell">
        <GamesRecord entry={entry} />
      </td>
    </tr>
  )
}

function QueueHead() {
  return (
    <thead className="border-y border-line/40">
      <tr>
        <th scope="col" className={`hidden w-[76px] text-left sm:table-cell ${columnLabelStyle}`}>
          Rank
        </th>
        <th scope="col" className={`text-left sm:pl-0 ${columnLabelStyle}`}>
          Player
        </th>
        <th scope="col" className={`hidden w-20 text-left sm:table-cell ${columnLabelStyle}`}>
          Region
        </th>
        <th scope="col" className={`w-[108px] text-right sm:w-24 ${columnLabelStyle}`}>
          Rating
        </th>
        <th scope="col" className={`hidden w-20 text-right sm:table-cell ${columnLabelStyle}`}>
          Change
        </th>
        <th scope="col" className={`hidden w-[176px] text-left sm:table-cell ${columnLabelStyle}`}>
          Games
        </th>
      </tr>
    </thead>
  )
}

export function QueueTable({ entries }: { entries: Entry[] }) {
  return (
    <table className={stripedTableStyle}>
      <QueueHead />
      <tbody>
        {entries.map((entry) => (
          <QueueRow key={rowKey(entry)} entry={entry} />
        ))}
      </tbody>
    </table>
  )
}

function SkeletonRow({ nameWidth }: { nameWidth: string }) {
  return (
    <tr className={stripedRowStyle}>
      <td className="hidden w-[76px] pr-3 pl-3 sm:table-cell">
        <span className={`${skeletonBarStyle} w-8`} />
      </td>
      <td className="max-w-0 pr-3 pl-3 sm:pl-0">
        <div className="flex items-center gap-3">
          <span className="size-9 shrink-0 animate-pulse rounded-md bg-white/[0.06] sm:size-7" />
          <span className={`${skeletonBarStyle} ${nameWidth}`} />
        </div>
      </td>
      <td className="hidden w-20 px-3 sm:table-cell">
        <span className={`${skeletonBarStyle} w-8`} />
      </td>
      <td className="w-[108px] pr-3 pl-3 sm:w-24">
        <span className={`${skeletonBarStyle} ml-auto w-12`} />
      </td>
      <td className="hidden w-20 px-3 sm:table-cell">
        <span className={`${skeletonBarStyle} ml-auto w-7`} />
      </td>
      <td className="hidden w-[176px] pr-3 pl-3 sm:table-cell">
        <span className={`${skeletonBarStyle} w-32`} />
      </td>
    </tr>
  )
}

const skeletonNameWidths = [
  'w-24',
  'w-40',
  'w-20',
  'w-32',
  'w-28',
  'w-44',
  'w-24',
  'w-36',
  'w-20',
  'w-32',
  'w-40',
  'w-28',
]

const skeletonRows = skeletonNameWidths.map((nameWidth, position) => ({ id: `row-${position}`, nameWidth }))

/** Stands in for the rows while a slow filter or page change loads, shaped like them so nothing jumps. */
export function QueueTableSkeleton() {
  return (
    <table aria-busy="true" aria-label="Loading recent activity" className={stripedTableStyle}>
      <QueueHead />
      <tbody>
        {skeletonRows.map((row) => (
          <SkeletonRow key={row.id} nameWidth={row.nameWidth} />
        ))}
      </tbody>
    </table>
  )
}
