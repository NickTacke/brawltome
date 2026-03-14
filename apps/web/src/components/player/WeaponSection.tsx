'use client'

import { useState, useRef } from 'react'
import { formatNum } from '@/lib/utils'
import { Card, Button, Progress } from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  type PlayerData,
  getWeaponIcon,
  formatHours,
  formatCompact,
  WinLossBar,
} from './shared'

interface WeaponSectionProps {
  weaponStats: PlayerData[]
}

export function WeaponSection({ weaponStats }: WeaponSectionProps) {
  const [showAllWeapons, setShowAllWeapons] = useState(false)
  const [expandedWeapon, setExpandedWeapon] = useState<string | null>(null)
  const weaponsRef = useRef<HTMLDivElement>(null)

  const displayedWeapons = showAllWeapons ? weaponStats : weaponStats.slice(0, 5)
  const totalTimeHeld = weaponStats.reduce((sum: number, w: PlayerData) => sum + (w.timeHeld ?? 0), 0)

  const handleToggleWeapons = () => {
    if (showAllWeapons) {
      weaponsRef.current?.scrollIntoView({ behavior: 'auto' })
    }
    setShowAllWeapons(!showAllWeapons)
  }

  if (weaponStats.length === 0) return null

  return (
    <div ref={weaponsRef} className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-foreground">
          Weapon Statistics
        </h2>
        <span className="text-sm text-muted-foreground font-mono">
          Total Weapons: {weaponStats.length}
        </span>
      </div>

      <Card className="overflow-hidden border-border">
        {displayedWeapons.map((w: PlayerData) => {
          const isExpanded = expandedWeapon === w.weapon
          const share = totalTimeHeld > 0 ? (w.timeHeld ?? 0) / totalTimeHeld : 0
          const dps = w.timeHeld > 0 ? Number(w.damage) / w.timeHeld : 0
          const dmgPerKO = w.kos > 0 ? Math.round(Number(w.damage) / w.kos) : 0

          return (
            <div
              key={w.weapon}
              className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${
                isExpanded ? 'bg-accent/20' : ''
              }`}
              onClick={() => setExpandedWeapon(isExpanded ? null : w.weapon)}
            >
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 relative shrink-0">
                    <img
                      src={getWeaponIcon(w.weapon)}
                      alt={w.weapon}
                      className="object-contain w-full h-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h3 className="font-bold text-foreground truncate text-sm">
                          {w.weapon}
                        </h3>
                        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
                          <span>{formatNum(w.kos)} KOs</span>
                          <span className="opacity-30">&bull;</span>
                          <span>{formatCompact(w.damage)} dmg</span>
                        </div>
                      </div>
                      {/* Playtime & Percentage - Prominent */}
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="text-lg font-black text-foreground leading-none">
                          {formatHours(w.timeHeld)}
                        </span>
                        <span className="text-sm font-bold text-primary">
                          {(share * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-[-4px] flex items-center gap-3">
                      <Progress value={share * 100} className="h-1.5 flex-1" />
                      <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {formatNum(w.kos)} KOs &bull; {formatCompact(w.damage)} dmg
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    {/* Two Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
                      {/* Left: Overall Stats */}
                      <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          Overall Stats
                        </div>

                        {/* Time held */}
                        <div className="space-y-1.5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-black text-foreground">
                              {formatHours(w.timeHeld)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              time held
                            </span>
                          </div>
                        </div>

                        {/* Combat Stats */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                              <div className="text-[9px] text-muted-foreground uppercase">KOs</div>
                            </div>
                            <div className="text-lg font-black text-success">
                              {formatNum(w.kos)}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                              <div className="text-[9px] text-muted-foreground uppercase">Damage</div>
                              <div className="text-[10px] font-bold text-foreground/70">
                                {dps.toFixed(1)} DPS
                              </div>
                            </div>
                            <div className="text-lg font-black text-foreground">
                              {formatCompact(w.damage)}
                            </div>
                          </div>
                        </div>

                        {/* Stats Row */}
                        <div className="grid grid-cols-4 gap-1 text-center">
                          <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                            <div className="text-sm font-black text-foreground">
                              {(share * 100).toFixed(0)}%
                            </div>
                            <div className="text-[8px] text-muted-foreground">Time %</div>
                          </div>
                          <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                            <div className="text-sm font-black text-foreground">
                              {dps.toFixed(1)}
                            </div>
                            <div className="text-[8px] text-muted-foreground">DPS</div>
                          </div>
                          <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                            <div className="text-sm font-black text-foreground">
                              {formatNum(dmgPerKO)}
                            </div>
                            <div className="text-[8px] text-muted-foreground">Dmg/KO</div>
                          </div>
                          <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                            <div className="text-sm font-black text-foreground">
                              {formatHours(w.timeHeld)}
                            </div>
                            <div className="text-[8px] text-muted-foreground">Time</div>
                          </div>
                        </div>
                      </div>

                      {/* Right: No ranked data available in v2 */}
                      <div className="space-y-3 md:pl-4">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                          Ranked Season
                        </div>
                        <div className="flex flex-col items-center justify-center py-6 text-center">
                          <div className="text-sm text-muted-foreground">
                            No ranked data per weapon
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      {weaponStats.length > 5 && (
        <div className="flex justify-center mt-6">
          <Button
            variant="outline"
            onClick={handleToggleWeapons}
            className="gap-2"
          >
            {showAllWeapons ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Weapons <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
