import type { EsportsProfile } from '../../../server/load-player'
import { FilterSelect } from '../../FilterSelect'
import { type EsportsMode, formatEarnings } from './esports-format'

export type ModeFilter = 'all' | EsportsMode

const modeOptions = [
  { value: 'all', label: 'All' },
  { value: '1v1', label: '1v1' },
  { value: '2v2', label: '2v2' },
]

const figure = 'text-2xl leading-none font-black tracking-tight text-strong tabular-nums'
const figureNote = 'text-sm font-semibold text-soft'

export function hasHeadline(esports: EsportsProfile): boolean {
  return esports.rankings.length > 0 || esports.earnings !== null
}

/** The headline facts beside the section title: power ranking per mode and earnings, where they exist. */
export function EsportsHeadline({ esports }: { esports: EsportsProfile }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      {esports.rankings.map((ranking) => (
        <span key={ranking.mode} className="whitespace-nowrap">
          <span className={figure}>PR {ranking.rank}</span>{' '}
          <span className={figureNote}>
            {ranking.region} {ranking.mode}
          </span>
        </span>
      ))}
      {esports.earnings !== null && (
        <span className="whitespace-nowrap">
          <span className={figure}>{formatEarnings(esports.earnings)}</span> <span className={figureNote}>earned</span>
        </span>
      )}
    </div>
  )
}

type ModeSelectProps = { mode: ModeFilter; onMode: (mode: ModeFilter) => void }

export function ModeSelect({ mode, onMode }: ModeSelectProps) {
  return (
    <FilterSelect label="Mode" value={mode} options={modeOptions} onChange={(next) => onMode(next as ModeFilter)} />
  )
}
