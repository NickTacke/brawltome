'use client'

import { formatNum } from '@/lib/utils'
import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import { Progress } from '@brawltome/ui'
import { formatCompact, formatHours, getWeaponIcon } from '../shared'
import { WeaponCardExpanded } from './WeaponCardExpanded'
import { computeWeaponDerived } from './utils'

interface WeaponCardProps {
  weapon: RichWeaponAgg
  isExpanded: boolean
  onToggle: () => void
}

export function WeaponCard({ weapon: w, isExpanded, onToggle }: WeaponCardProps) {
  const { winrate } = computeWeaponDerived(w)
  const panelId = `weapon-panel-${w.weapon}`

  return (
    <div
      className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${isExpanded ? 'bg-accent/20' : ''}`}
      // biome-ignore lint/a11y/useSemanticElements: complex expandable card layout
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-controls={panelId}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle()
      }}
    >
      <div className="p-4 relative overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 relative shrink-0">
            <img src={getWeaponIcon(w.weapon)} alt={w.weapon} className="object-contain w-full h-full" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h3 className="font-bold text-foreground truncate text-sm">{w.weapon}</h3>
                <div className="mt-0.5 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
                  <span>{formatNum(w.games)} games</span>
                  <span className="opacity-30">&bull;</span>
                  <span className={winrate >= 50 ? 'text-success font-bold' : ''}>{winrate.toFixed(1)}% WR</span>
                </div>
              </div>
              <div className="flex items-baseline gap-2 shrink-0">
                <span className="text-lg font-black text-foreground leading-none">{formatHours(w.timeHeld)}</span>
                <span className="text-sm font-bold text-primary">{(w.share * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div className="mt-[-4px] flex items-center gap-3">
              <Progress value={w.share * 100} className="h-1.5 flex-1 bg-muted" />
              <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                {formatNum(w.KOs)} KOs &bull; {formatCompact(w.damage)} dmg
              </div>
            </div>
          </div>
        </div>

        <WeaponCardExpanded weapon={w} isExpanded={isExpanded} panelId={panelId} />
      </div>
    </div>
  )
}
