import type { LeadKind } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { classRules } from '../review/moment-class'
import type { OpeningRecord } from './opening-records'

export type OpeningWay = 'won' | 'lost'

const ways: Record<
  OpeningWay,
  { title: string; bar: string; count: (record: OpeningRecord) => number; damage: (record: OpeningRecord) => number }
> = {
  won: {
    title: 'Opened them up',
    bar: 'bg-primary/80',
    count: (record) => record.won.length,
    damage: (record) => record.damageWon,
  },
  lost: {
    title: 'Got opened up',
    bar: 'bg-red-400/70',
    count: (record) => record.lost.length,
    damage: (record) => record.damageLost,
  },
}

function timesText(count: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'}`
}

type OpeningKindListProps = {
  way: OpeningWay
  records: OpeningRecord[]
  selected: LeadKind | null
  onSelect: (kind: LeadKind) => void
}

/** One way round of the neutral game: every way an opening began, by the damage it led to. */
export function OpeningKindList({ way, records, selected, onSelect }: OpeningKindListProps) {
  const { title, bar, count, damage } = ways[way]
  const shown = records.filter((record) => count(record) > 0).sort((left, right) => damage(right) - damage(left))
  const highest = Math.max(1, ...shown.map(damage))
  const total = shown.reduce((sum, record) => sum + count(record), 0)

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-3">
        <h3 className="font-bold text-text">{title}</h3>
        <span className="text-[0.8125rem] text-soft tabular-nums">
          <span className="font-black text-strong">{total}</span> {total === 1 ? 'time' : 'times'}
        </span>
      </div>
      <div className="mt-1.5">
        {shown.map((record) => (
          <button
            key={record.kind}
            type="button"
            aria-expanded={record.kind === selected}
            title={classRules[record.kind]}
            onClick={() => onSelect(record.kind)}
            className={`block w-full cursor-pointer rounded-md px-3 py-1.5 text-left transition-colors hover:bg-white/[0.04] ${record.kind === selected ? 'bg-white/[0.05] ring-2 ring-primary' : ''}`}
          >
            <span className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold text-text">{record.label}</span>
              <span className="text-xs text-soft tabular-nums">{timesText(count(record))}</span>
              <span className="w-9 text-right font-black tracking-tight text-strong tabular-nums">
                {formatDamage(damage(record))}
              </span>
            </span>
            <span
              className={`mt-1.5 block h-1 rounded-full ${bar}`}
              style={{ width: `${Math.max((damage(record) / highest) * 100, 2)}%` }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
