import type { ReactNode } from 'react'
import { statLabel } from './player-styles'

export function CardStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={statLabel}>{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-bold text-strong">{children}</div>
    </div>
  )
}

export function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-soft">{label}</div>
      <div className="mt-0.5 font-mono font-semibold text-strong">{value}</div>
    </div>
  )
}
