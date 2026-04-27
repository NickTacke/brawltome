'use client'

import { formatNum } from '@/lib/utils'
import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import { WinLossBar, formatCompact, formatHours } from '../shared'
import type { WeaponDerived } from './utils'

interface WeaponOverallStatsProps {
  weapon: RichWeaponAgg
  derived: WeaponDerived
}

export function WeaponOverallStats({ weapon: w, derived }: WeaponOverallStatsProps) {
  const { winrate, dps, avgKos, dmgPerKO, avgDmgPerGame, avgLegendLevel, avgLegendXp } = derived

  return (
    <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        Overall Stats
      </div>

      {/* Games & Winrate */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-foreground">{formatNum(w.games)}</span>
          <span className="text-xs text-muted-foreground">games</span>
          <span className="text-muted-foreground/30 mx-1">&bull;</span>
          <span className="text-sm font-mono text-muted-foreground">{formatHours(w.timeHeld)}</span>
        </div>
        <WinLossBar percent={winrate} className="h-2" />
        <div className="flex justify-between text-[10px] font-bold">
          <span className="text-foreground">
            {formatNum(w.wins)}W <span className="font-normal text-muted-foreground">({winrate.toFixed(1)}%)</span>
          </span>
          <span className="text-foreground">
            {formatNum(w.games - w.wins)}L{' '}
            <span className="font-normal text-muted-foreground">({(100 - winrate).toFixed(1)}%)</span>
          </span>
        </div>
      </div>

      {/* Combat Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
          <div className="flex justify-between items-start mb-1">
            <div className="text-[9px] text-muted-foreground uppercase">KOs</div>
            <div className="text-[10px] font-bold text-foreground/70">{avgKos.toFixed(1)}/game</div>
          </div>
          <div className="text-lg font-black text-success">{formatNum(w.KOs)}</div>
        </div>
        <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
          <div className="flex justify-between items-start mb-1">
            <div className="text-[9px] text-muted-foreground uppercase">Damage</div>
            <div className="text-[10px] font-bold text-foreground/70">{dps.toFixed(1)} DPS</div>
          </div>
          <div className="text-lg font-black text-foreground">{formatCompact(w.damage)}</div>
          <div className="text-[9px] text-muted-foreground">{formatNum(avgDmgPerGame)}/game</div>
        </div>
      </div>

      {/* Stats Row 1 */}
      <div className="grid grid-cols-4 gap-1 text-center">
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{(w.share * 100).toFixed(0)}%</div>
          <div className="text-[8px] text-muted-foreground">Time %</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{(w.usageRate * 100).toFixed(0)}%</div>
          <div className="text-[8px] text-muted-foreground">Usage</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{formatNum(dmgPerKO)}</div>
          <div className="text-[8px] text-muted-foreground">Dmg/KO</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{w.legendCount}</div>
          <div className="text-[8px] text-muted-foreground">Legends</div>
        </div>
      </div>

      {/* Stats Row 2 - Level & XP */}
      <div className="grid grid-cols-4 gap-1 text-center">
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{formatNum(w.totalLevel)}</div>
          <div className="text-[8px] text-muted-foreground">Level</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{avgLegendLevel}</div>
          <div className="text-[8px] text-muted-foreground">Avg Lvl</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{formatCompact(w.xp)}</div>
          <div className="text-[8px] text-muted-foreground">XP</div>
        </div>
        <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
          <div className="text-sm font-black text-foreground">{formatCompact(avgLegendXp)}</div>
          <div className="text-[8px] text-muted-foreground">Avg XP</div>
        </div>
      </div>
    </div>
  )
}
