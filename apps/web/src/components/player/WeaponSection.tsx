'use client'

import { formatNum } from '@/lib/utils'
import type { RichWeaponAgg } from '@/lib/weapon-aggregation'
import {
  Avatar,
  AvatarImage,
  Button,
  Card,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { WinLossBar, formatCompact, formatHours, getWeaponIcon } from './shared'

interface WeaponSectionProps {
  weaponStats: RichWeaponAgg[]
}

type WeaponSortKey = 'timePlayed' | 'games' | 'winrate' | 'damage' | 'kos'

const WEAPON_SORT_OPTIONS: { value: WeaponSortKey; label: string }[] = [
  { value: 'timePlayed', label: 'Time Played' },
  { value: 'games', label: 'Games' },
  { value: 'winrate', label: 'Win Rate' },
  { value: 'damage', label: 'Damage' },
  { value: 'kos', label: 'KOs' },
]

export function WeaponSection({ weaponStats }: WeaponSectionProps) {
  const [showAllWeapons, setShowAllWeapons] = useState(false)
  const [expandedWeapon, setExpandedWeapon] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<WeaponSortKey>('timePlayed')
  const weaponsRef = useRef<HTMLDivElement>(null)

  const sortedWeapons = [...weaponStats].sort((a, b) => {
    switch (sortBy) {
      case 'games':
        return b.games - a.games
      case 'winrate': {
        const wrA = a.games > 0 ? a.wins / a.games : 0
        const wrB = b.games > 0 ? b.wins / b.games : 0
        return wrB - wrA
      }
      case 'damage':
        return b.damage - a.damage
      case 'kos':
        return b.KOs - a.KOs
      case 'timePlayed':
      default:
        return b.timeHeld - a.timeHeld
    }
  })

  const displayedWeapons = showAllWeapons ? sortedWeapons : sortedWeapons.slice(0, 5)

  const handleToggleWeapons = () => {
    if (showAllWeapons) {
      weaponsRef.current?.scrollIntoView({ behavior: 'auto' })
    }
    setShowAllWeapons(!showAllWeapons)
  }

  if (weaponStats.length === 0) return null

  return (
    <div ref={weaponsRef} className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground">Weapon Statistics</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-mono">Weapons: {weaponStats.length}</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as WeaponSortKey)}>
            <SelectTrigger className="w-[130px] font-bold h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEAPON_SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="cursor-pointer text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-border">
        {displayedWeapons.map((w) => {
          const isExpanded = expandedWeapon === w.weapon
          const winrate = w.games > 0 ? (w.wins / w.games) * 100 : 0
          const dps = w.timeHeld > 0 ? w.damage / w.timeHeld : 0
          const avgKos = w.games > 0 ? w.KOs / w.games : 0

          const avgElo =
            w.ranked.ratings.length > 0 ? w.ranked.ratings.reduce((a, b) => a + b, 0) / w.ranked.ratings.length : 0
          const avgPeak =
            w.ranked.peakRatings.length > 0
              ? w.ranked.peakRatings.reduce((a, b) => a + b, 0) / w.ranked.peakRatings.length
              : 0

          return (
            <div
              key={w.weapon}
              className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${isExpanded ? 'bg-accent/20' : ''}`}
              // biome-ignore lint/a11y/useSemanticElements: complex expandable card layout
              role="button"
              tabIndex={0}
              onClick={() => setExpandedWeapon(isExpanded ? null : w.weapon)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setExpandedWeapon(isExpanded ? null : w.weapon)
              }}
            >
              <div className="p-4 space-y-3">
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
                          <span className={winrate >= 50 ? 'text-success font-bold' : ''}>
                            {winrate.toFixed(1)}% WR
                          </span>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="text-lg font-black text-foreground leading-none">
                          {formatHours(w.timeHeld)}
                        </span>
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

                {isExpanded &&
                  (() => {
                    const rankedWinrate = w.ranked.games > 0 ? (w.ranked.wins / w.ranked.games) * 100 : 0
                    const dmgPerKO = w.KOs > 0 ? Math.round(w.damage / w.KOs) : 0
                    const avgDmgPerGame = w.games > 0 ? Math.round(w.damage / w.games) : 0
                    const avgLegendLevel = w.legendCount > 0 ? Math.round(w.totalLevel / w.legendCount) : 0
                    const avgLegendXp = w.legendCount > 0 ? Math.round(w.xp / w.legendCount) : 0

                    return (
                      <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
                          {/* Left: Overall Stats */}
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
                                <span className="text-sm font-mono text-muted-foreground">
                                  {formatHours(w.timeHeld)}
                                </span>
                              </div>
                              <WinLossBar percent={winrate} className="h-2" />
                              <div className="flex justify-between text-[10px] font-bold">
                                <span className="text-foreground">
                                  {formatNum(w.wins)}W{' '}
                                  <span className="font-normal text-muted-foreground">({winrate.toFixed(1)}%)</span>
                                </span>
                                <span className="text-foreground">
                                  {formatNum(w.games - w.wins)}L{' '}
                                  <span className="font-normal text-muted-foreground">
                                    ({(100 - winrate).toFixed(1)}%)
                                  </span>
                                </span>
                              </div>
                            </div>

                            {/* Combat Stats */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="text-[9px] text-muted-foreground uppercase">KOs</div>
                                  <div className="text-[10px] font-bold text-foreground/70">
                                    {avgKos.toFixed(1)}/game
                                  </div>
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
                                <div className="text-sm font-black text-foreground">
                                  {(w.usageRate * 100).toFixed(0)}%
                                </div>
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

                          {/* Right: Ranked Season */}
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
                                    <span className="text-2xl font-black text-foreground">
                                      {formatNum(w.ranked.games)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">ranked games</span>
                                  </div>
                                  <WinLossBar percent={rankedWinrate} className="h-2" />
                                  <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-foreground">
                                      {formatNum(w.ranked.wins)}W{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({rankedWinrate.toFixed(1)}%)
                                      </span>
                                    </span>
                                    <span className="text-foreground">
                                      {formatNum(w.ranked.games - w.ranked.wins)}L{' '}
                                      <span className="font-normal text-muted-foreground">
                                        ({(100 - rankedWinrate).toFixed(1)}%)
                                      </span>
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
                                        <span className="text-xs font-bold text-foreground">
                                          {w.ranked.mostPlayed.games} games
                                        </span>
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
                                        <span className="text-xs font-bold text-foreground">
                                          {w.ranked.highestElo.elo}
                                        </span>
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
                                        <span className="text-xs font-bold text-foreground">
                                          {w.ranked.highestPeak.elo}
                                        </span>
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
                        </div>
                      </div>
                    )
                  })()}
              </div>
            </div>
          )
        })}
      </Card>

      {weaponStats.length > 5 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggleWeapons} className="gap-2">
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
