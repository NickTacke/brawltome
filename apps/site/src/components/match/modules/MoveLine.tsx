import type { MoveRow } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { moveCode } from '../review/move-notation'
import { weaponLabel } from '../weapon-label'
import { landedShare } from './move-sorts'
import { weaponImageUrl } from './weapon-image'

/** One move: what it is, how much it did, and under it how many of its uses landed. */
export function MoveLine({ move }: { move: MoveRow }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 text-sm">
        <img
          src={weaponImageUrl(move.weapon)}
          alt={weaponLabel(move.weapon)}
          className="size-5 shrink-0 object-contain"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-text" title={move.label}>
          {moveCode(move.label)}
        </span>
        {move.kos > 0 && (
          <span className="text-xs font-bold whitespace-nowrap text-strong tabular-nums">
            {`${move.kos} ${move.kos === 1 ? 'KO' : 'KOs'}`}
          </span>
        )}
        <span className="text-xs whitespace-nowrap text-soft tabular-nums">{`${move.usesLanded} of ${move.uses}`}</span>
        <span className="w-8 text-right font-black tracking-tight text-strong tabular-nums">
          {formatDamage(move.damage)}
        </span>
      </div>
      <div className="mt-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full">
        <div className="bg-primary/80" style={{ width: `${landedShare(move) * 100}%` }} />
        <div className="flex-1 bg-white/[0.14]" />
      </div>
    </div>
  )
}
