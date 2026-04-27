'use client'

import { formatNum } from '@/lib/utils'
import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import { Avatar, AvatarImage } from '@brawltome/ui'
import { WinLossBar } from '../shared'
import type { WeaponDerived } from './utils'

interface WeaponRankedStatsProps {
  weapon: RichWeaponAgg
  derived: WeaponDerived
}

export function WeaponRankedStats({ weapon: w, derived }: WeaponRankedStatsProps) {
  const { rankedWinrate, avgElo, avgPeak } = derived

  return (
    <div className="space-y-3 md:pl-4">
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
        Ranked Season
      </div>

      {w.ranked.games > 0 ? (
        <div className="space-y-3 mt-3">
          {/* Games & Winrate */}
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-foreground">{formatNum(w.ranked.games)}</span>
              <span className="text-xs text-muted-foreground">ranked games</span>
            </div>
            <WinLossBar percent={rankedWinrate} className="h-2" />
            <div className="flex justify-between text-[10px] font-bold">
              <span className="text-foreground">
                {formatNum(w.ranked.wins)}W{' '}
                <span className="font-normal text-muted-foreground">({rankedWinrate.toFixed(1)}%)</span>
              </span>
              <span className="text-foreground">
                {formatNum(w.ranked.games - w.ranked.wins)}L{' '}
                <span className="font-normal text-muted-foreground">({(100 - rankedWinrate).toFixed(1)}%)</span>
              </span>
            </div>
          </div>

          {/* Elo Stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
              <div className="text-lg font-black text-foreground">{Math.round(avgElo)}</div>
              <div className="text-[8px] text-muted-foreground uppercase">Avg Elo</div>
            </div>
            <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
              <div className="text-lg font-black text-foreground">{Math.round(avgPeak)}</div>
              <div className="text-[8px] text-muted-foreground uppercase">Avg Peak</div>
            </div>
          </div>

          {/* Legend Stats */}
          <div className="space-y-1.5">
            {w.ranked.mostPlayed.key && (
              <div className="flex items-center gap-2 p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                <Avatar className="h-6 w-6 rounded-sm">
                  <AvatarImage src={`/images/legends/avatars/${w.ranked.mostPlayed.key}.png`} />
                </Avatar>
                <div className="flex-1 min-w-0 flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Most Played</span>
                  <span className="text-xs font-bold text-foreground">{w.ranked.mostPlayed.games} games</span>
                </div>
              </div>
            )}
            {w.ranked.highestElo.key && (
              <div className="flex items-center gap-2 p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                <Avatar className="h-6 w-6 rounded-sm">
                  <AvatarImage src={`/images/legends/avatars/${w.ranked.highestElo.key}.png`} />
                </Avatar>
                <div className="flex-1 min-w-0 flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Highest Elo</span>
                  <span className="text-xs font-bold text-foreground">{w.ranked.highestElo.elo}</span>
                </div>
              </div>
            )}
            {w.ranked.highestPeak.key && (
              <div className="flex items-center gap-2 p-1.5 mb-2 rounded bg-background/20 hover:bg-background/30 transition-colors">
                <Avatar className="h-6 w-6 rounded-sm">
                  <AvatarImage src={`/images/legends/avatars/${w.ranked.highestPeak.key}.png`} />
                </Avatar>
                <div className="flex-1 min-w-0 flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Highest Peak</span>
                  <span className="text-xs font-bold text-foreground">{w.ranked.highestPeak.elo}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="text-sm text-muted-foreground">No ranked games this season</div>
        </div>
      )}
    </div>
  )
}
