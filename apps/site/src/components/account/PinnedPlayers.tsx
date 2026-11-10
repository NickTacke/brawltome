import type { PinnedPlayerRow } from './account-model'
import { PinRow } from './PinRow'

export const sectionTitleStyle = 'text-xl font-bold text-strong'

type PinnedPlayersProps = {
  verifiedPlayer: PinnedPlayerRow | null
  pins: PinnedPlayerRow[]
  isBusy: boolean
  hasFailed: boolean
  onMove: (brawlhallaId: number, step: -1 | 1) => void
  onUnpin: (brawlhallaId: number) => void
}

export function PinnedPlayers({ verifiedPlayer, pins, isBusy, hasFailed, onMove, onUnpin }: PinnedPlayersProps) {
  const count = pins.length + (verifiedPlayer ? 1 : 0)

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={sectionTitleStyle}>Pinned players</h2>
        {count > 0 && (
          <span className="text-[13px] text-soft tabular-nums">
            <span className="font-black text-strong">{count}</span> pinned
          </span>
        )}
      </div>
      {count === 0 && <p className="mt-3 text-soft">No pinned players yet. Players you pin show up here.</p>}
      {hasFailed && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          Couldn't save that change. Please try again.
        </p>
      )}
      <ul className="mt-2 divide-y divide-line/30">
        {verifiedPlayer && <PinRow row={verifiedPlayer} actions={null} />}
        {pins.map((row, index) => (
          <PinRow
            key={row.brawlhallaId}
            row={row}
            actions={{
              canMoveUp: index > 0,
              canMoveDown: index < pins.length - 1,
              isBusy,
              onMove: (step) => onMove(row.brawlhallaId, step),
              onUnpin: () => onUnpin(row.brawlhallaId),
            }}
          />
        ))}
      </ul>
    </section>
  )
}
