import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { formatWhole } from '../../lib'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { PlayerLink } from '../guild/PlayerLink'
import { rankBanner, tierColour, tierName, winPercent, winRateColour } from '../player/player-format'
import { regionOption } from '../regions'
import { type PinnedPlayerRow, playerLabel } from './account-model'

const actionStyle =
  'flex size-8 items-center justify-center rounded-sm text-soft transition-colors hover:bg-white/[0.08] hover:text-strong disabled:opacity-25 disabled:hover:bg-transparent'

function Avatar({ row }: { row: PinnedPlayerRow }) {
  const frameColour = `color-mix(in srgb, ${tierColour(row.tier)} 50%, var(--color-ink))`

  return (
    <div className="size-12 shrink-0 overflow-hidden rounded-lg p-[0.125rem]" style={{ backgroundColor: frameColour }}>
      <img
        src={legendAvatarUrl(row.legendNameKey)}
        alt=""
        className="size-full rounded-md bg-raised object-cover object-top"
      />
    </div>
  )
}

function NameAndTier({ row, isVerified }: { row: PinnedPlayerRow; isVerified: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <PlayerLink playerId={row.brawlhallaId} className="truncate font-bold text-strong hover:text-primary">
          {playerLabel(row)}
        </PlayerLink>
        {regionOption(row.region)?.flag}
      </div>
      <div className="truncate text-sm font-semibold text-soft">
        {tierName(row.tier)}
        {isVerified && <span className="font-normal"> · Your account</span>}
      </div>
    </div>
  )
}

function RatingAndRecord({ row }: { row: PinnedPlayerRow }) {
  const percent = winPercent(row.wins, row.games)

  return (
    <>
      <img src={rankBanner(row.tier)} alt="" className="h-11 w-8 shrink-0 object-contain max-sm:hidden" />
      <div className="w-20 shrink-0 text-right">
        <div className="text-xl leading-none font-black tracking-tight text-strong tabular-nums">
          {row.rating === null ? '—' : formatWhole(row.rating)}
        </div>
        {row.peakRating !== null && (
          <div className="mt-1 font-mono text-xs text-soft/70">/ {formatWhole(row.peakRating)}</div>
        )}
      </div>
      <div className="w-24 shrink-0 text-right font-mono text-sm text-soft max-md:hidden">
        {row.games > 0 && <span className={`font-bold ${winRateColour(percent)}`}>{percent.toFixed(1)}%</span>}
        <div className="text-xs">{row.games > 0 ? `of ${formatWhole(row.games)}` : 'No games'}</div>
      </div>
    </>
  )
}

type PinActionsProps = {
  label: string
  canMoveUp: boolean
  canMoveDown: boolean
  isBusy: boolean
  onMove: (step: -1 | 1) => void
  onUnpin: () => void
}

function PinActions({ label, canMoveUp, canMoveDown, isBusy, onMove, onUnpin }: PinActionsProps) {
  return (
    <>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={!canMoveUp || isBusy}
        onClick={() => onMove(-1)}
        className={actionStyle}
      >
        <ArrowUp className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={!canMoveDown || isBusy}
        onClick={() => onMove(1)}
        className={actionStyle}
      >
        <ArrowDown className="size-4" aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Unpin ${label}`} disabled={isBusy} onClick={onUnpin} className={actionStyle}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </>
  )
}

// the verified account has no actions: it always leads, and the api refuses to move it
type PinRowProps = { row: PinnedPlayerRow; actions: Omit<PinActionsProps, 'label'> | null }

export function PinRow({ row, actions }: PinRowProps) {
  return (
    <li className="group -mx-3 flex items-center gap-3.5 rounded-md px-3 py-2.5 transition-colors hover:bg-white/[0.04]">
      <Avatar row={row} />
      <NameAndTier row={row} isVerified={actions === null} />
      <RatingAndRecord row={row} />
      <div className="flex w-[6.5rem] shrink-0 justify-end opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        {actions && <PinActions label={playerLabel(row)} {...actions} />}
      </div>
    </li>
  )
}
