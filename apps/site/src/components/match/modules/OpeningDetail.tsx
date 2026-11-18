import type { Moment } from '@brawltome/contracts'
import { statLabel } from '../../player/player-styles'
import { formatClock, formatDamage } from '../match-format'
import { HitString } from '../review/ReviewFacts'
import { WatchButton } from '../WatchButton'
import { DetailHeader } from './DetailHeader'
import type { OpeningRecord } from './opening-records'

// exchanges one under the other: when each started, its hits in order, and whether it ended in a KO
function ExchangeList({ title, moments }: { title: string; moments: Moment[] }) {
  return (
    <div className="min-w-0">
      <div className={statLabel}>{title}</div>
      {moments.length === 0 && <p className="mt-1.5 text-sm text-soft">None</p>}
      {moments.map((moment) => (
        <div key={moment.key} className="flex items-center gap-3 border-b border-line/30 py-1.5 last:border-b-0">
          <span className="w-9 shrink-0 font-mono text-xs text-soft tabular-nums">{formatClock(moment.timeMs)}</span>
          <div className="min-w-0 flex-1">
            <HitString moment={moment} />
          </div>
          {moment.knockout && <span className={`${statLabel} text-primary`}>KO</span>}
          <WatchButton timeMs={moment.timeMs} />
        </div>
      ))}
    </div>
  )
}

type OpeningDetailProps = { record: OpeningRecord; onClose: () => void }

/** Every exchange that began this way: the ones the picked player landed, and the ones they took. */
export function OpeningDetail({ record, onClose }: OpeningDetailProps) {
  return (
    <div className="space-y-4">
      <DetailHeader
        title={record.label}
        note={`${formatDamage(record.damageWon)} dealt · ${formatDamage(record.damageLost)} taken`}
        onClose={onClose}
      />
      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
        <ExchangeList title={`Landed ${record.won.length}`} moments={record.won} />
        <ExchangeList title={`Taken ${record.lost.length}`} moments={record.lost} />
      </div>
    </div>
  )
}
