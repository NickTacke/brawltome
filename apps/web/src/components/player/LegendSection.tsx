'use client'

import { formatNum } from '@/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  type PlayerData,
  WinLossBar,
  calculateEloReset,
  formatCompact,
  formatHours,
  getRankBanner,
  getWeaponIcon,
  parseNum,
} from './shared'

interface LegendSectionProps {
  allLegends: PlayerData[]
  rankedLegends: PlayerData[]
}

type LegendSortKey = 'xp' | 'winrate' | 'games' | 'playtime' | 'level' | 'elo' | 'peakElo'

const LEGEND_SORT_OPTIONS: { value: LegendSortKey; label: string }[] = [
  { value: 'xp', label: 'XP' },
  { value: 'winrate', label: 'Win Rate' },
  { value: 'games', label: 'Games' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'level', label: 'Level' },
  { value: 'elo', label: 'Elo' },
  { value: 'peakElo', label: 'Peak Elo' },
]

export function LegendSection({ allLegends, rankedLegends }: LegendSectionProps) {
  const [showAllLegends, setShowAllLegends] = useState(false)
  const [expandedLegendId, setExpandedLegendId] = useState<number | null>(null)
  const [openedLegendIds, setOpenedLegendIds] = useState<Set<number>>(new Set())
  const [sortBy, setSortBy] = useState<LegendSortKey>('xp')
  const legendsRef = useRef<HTMLDivElement>(null)

  const toggleLegend = (id: number) => {
    if (expandedLegendId === id) {
      setExpandedLegendId(null)
      return
    }
    setOpenedLegendIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setExpandedLegendId(id)
  }

  const sortedLegends = [...allLegends].sort((a: PlayerData, b: PlayerData) => {
    switch (sortBy) {
      case 'winrate': {
        const wrA = a.games > 0 ? a.wins / a.games : 0
        const wrB = b.games > 0 ? b.wins / b.games : 0
        return wrB - wrA
      }
      case 'games':
        return (b.games ?? 0) - (a.games ?? 0)
      case 'playtime':
        return parseNum(b.matchTime) - parseNum(a.matchTime)
      case 'level':
        return (b.level ?? 0) - (a.level ?? 0)
      case 'elo': {
        const eloA = rankedLegends.find((r: PlayerData) => r.legendId === a.legendId)?.rating ?? 0
        const eloB = rankedLegends.find((r: PlayerData) => r.legendId === b.legendId)?.rating ?? 0
        return eloB - eloA
      }
      case 'peakElo': {
        const peakA = rankedLegends.find((r: PlayerData) => r.legendId === a.legendId)?.peakRating ?? 0
        const peakB = rankedLegends.find((r: PlayerData) => r.legendId === b.legendId)?.peakRating ?? 0
        return peakB - peakA
      }
      default:
        return (b.xp ?? 0) - (a.xp ?? 0)
    }
  })

  const displayedLegends = showAllLegends ? sortedLegends : sortedLegends.slice(0, 5)

  const handleToggleLegends = () => {
    if (showAllLegends) {
      legendsRef.current?.scrollIntoView({ behavior: 'auto' })
    }
    setShowAllLegends(!showAllLegends)
  }

  if (allLegends.length === 0) return null

  return (
    <div id="legends-section" ref={legendsRef} className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground">Legend Statistics</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-mono">Played: {allLegends.length}</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as LegendSortKey)}>
            <SelectTrigger className="w-[130px] font-bold h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEGEND_SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="cursor-pointer text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-border">
        {displayedLegends.map((legend: PlayerData) => {
          const isExpanded = expandedLegendId === legend.legendId
          const wr = legend.games > 0 ? (legend.wins / legend.games) * 100 : 0
          const rankedLegend = rankedLegends.find((r: PlayerData) => r.legendId === legend.legendId)

          return (
            <div
              key={legend.legendId}
              className={`transition-all duration-200 cursor-pointer hover:bg-accent/30 ${
                isExpanded ? 'bg-accent/20' : ''
              }`}
              // biome-ignore lint/a11y/useSemanticElements: complex expandable card layout
              role="button"
              tabIndex={0}
              onClick={() => toggleLegend(legend.legendId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggleLegend(legend.legendId)
              }}
            >
              <div className="p-4 relative overflow-hidden">
                <div className="flex items-center gap-4 relative z-10">
                  <Avatar className="w-12 h-12 rounded-lg shadow-sm shrink-0">
                    <AvatarImage
                      src={`/images/legends/avatars/${legend.legendNameKey}.png`}
                      alt={legend.legendNameKey}
                      className="object-cover object-top"
                      loading="lazy"
                    />
                    <AvatarFallback className="bg-muted text-lg font-bold text-muted-foreground capitalize rounded-md">
                      {legend.legendNameKey?.[0] || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold capitalize truncate text-sm">{legend.legendNameKey}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
                      <span>{formatNum(legend.xp)} XP</span>
                      <span className="opacity-30">&bull;</span>
                      <span className={wr > 50 ? 'text-success font-bold' : ''}>{wr.toFixed(0)}% WR</span>
                      <span className="opacity-30">&bull;</span>
                      <span>{formatHours(parseNum(legend.matchTime))}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 sm:hidden">
                      <Badge variant="secondary" className="text-xs font-mono px-2 py-1 h-7">
                        Lvl {legend.level}
                      </Badge>
                      {rankedLegend && !isExpanded && (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7"
                        >
                          {rankedLegend.tier} &bull; {rankedLegend.rating}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-xs font-mono px-2 py-1 h-7">
                      Lvl {legend.level}
                    </Badge>
                    {rankedLegend && !isExpanded && (
                      <Badge
                        variant="outline"
                        className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7"
                      >
                        {rankedLegend.tier} &bull; {rankedLegend.rating}
                      </Badge>
                    )}
                  </div>
                </div>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out relative z-10 ${
                    isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                  aria-hidden={!isExpanded}
                >
                  <div className="min-h-0 overflow-hidden">
                {openedLegendIds.has(legend.legendId) &&
                  (() => {
                    const matchTime = parseNum(legend.matchTime)
                    const legendGames = parseNum(legend.games)
                    const legendWins = parseNum(legend.wins)
                    const legendKOs = parseNum(legend.kos)
                    const legendFalls = parseNum(legend.falls)
                    const legendSuicides = parseNum(legend.suicides)
                    const legendDmgDealt = parseNum(legend.damageDealt)
                    const legendDmgTaken = parseNum(legend.damageTaken)
                    const legendWinrate = legendGames > 0 ? (legendWins / legendGames) * 100 : 0

                    const dpsDealt = matchTime > 0 ? legendDmgDealt / matchTime : 0
                    const avgKOsPerGame = legendGames > 0 ? legendKOs / legendGames : 0
                    const avgFallsPerGame = legendGames > 0 ? legendFalls / legendGames : 0
                    const kdRatio = legendFalls > 0 ? legendKOs / legendFalls : legendKOs
                    const dmgRatio =
                      legendDmgDealt + legendDmgTaken > 0
                        ? (legendDmgDealt / (legendDmgDealt + legendDmgTaken)) * 100
                        : 50

                    // Weapon stats for distribution
                    const weaponOneTime = parseNum(legend.timeHeldWeaponOne)
                    const weaponTwoTime = parseNum(legend.timeHeldWeaponTwo)
                    const unarmedTime = Math.max(0, matchTime - weaponOneTime - weaponTwoTime)
                    const totalWeaponTime = weaponOneTime + weaponTwoTime + unarmedTime

                    const weaponOneKOs = parseNum(legend.koWeaponOne)
                    const weaponTwoKOs = parseNum(legend.koWeaponTwo)
                    const unarmedKOs = parseNum(legend.koUnarmed)
                    const totalWeaponKOs = weaponOneKOs + weaponTwoKOs + unarmedKOs

                    const weaponOneDmg = parseNum(legend.damageWeaponOne)
                    const weaponTwoDmg = parseNum(legend.damageWeaponTwo)
                    const unarmedDmg = parseNum(legend.damageUnarmed)
                    const totalWeaponDmg = weaponOneDmg + weaponTwoDmg + unarmedDmg

                    const weaponDistribution = [
                      { name: 'Weapon 1', kos: weaponOneKOs, dmg: weaponOneDmg, time: weaponOneTime },
                      { name: 'Weapon 2', kos: weaponTwoKOs, dmg: weaponTwoDmg, time: weaponTwoTime },
                      { name: 'Unarmed', kos: unarmedKOs, dmg: unarmedDmg, time: unarmedTime },
                    ].filter((w) => w.kos > 0 || w.dmg > 0 || w.time > 0)

                    return (
                      <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10 space-y-4">
                        {/* Two Column Layout with Divider */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0">
                          {/* Left Column: Overall Stats */}
                          <div className="space-y-3 md:pr-4 md:border-r md:border-border/30">
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              Overall Stats
                            </div>

                            {/* Games & Winrate */}
                            <div className="space-y-1.5">
                              <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-black text-foreground">{formatNum(legendGames)}</span>
                                <span className="text-xs text-muted-foreground">games</span>
                                <span className="text-muted-foreground/30 mx-1">&bull;</span>
                                <span className="text-sm font-mono text-muted-foreground">
                                  {formatHours(matchTime)}
                                </span>
                              </div>
                              <WinLossBar percent={legendWinrate} className="h-2" />
                              <div className="flex justify-between text-[10px] font-bold">
                                <span className="text-foreground">
                                  {formatNum(legendWins)}W{' '}
                                  <span className="font-normal text-muted-foreground">
                                    ({legendWinrate.toFixed(1)}%)
                                  </span>
                                </span>
                                <span className="text-foreground">
                                  {formatNum(legendGames - legendWins)}L{' '}
                                  <span className="font-normal text-muted-foreground">
                                    ({(100 - legendWinrate).toFixed(1)}%)
                                  </span>
                                </span>
                              </div>
                            </div>

                            {/* Combat Stats Grid */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="text-[9px] text-muted-foreground uppercase">KOs / Falls</div>
                                  <div className="text-[10px] font-bold text-foreground/70">
                                    {kdRatio.toFixed(2)} K/D
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div>
                                    <div className="text-lg font-black text-success">{formatNum(legendKOs)}</div>
                                    <div className="text-[8px] text-muted-foreground">KOs</div>
                                  </div>
                                  <span className="text-muted-foreground/30 text-lg">/</span>
                                  <div>
                                    <div className="text-lg font-black text-danger">{formatNum(legendFalls)}</div>
                                    <div className="text-[8px] text-muted-foreground">falls</div>
                                  </div>
                                </div>
                                {legendSuicides > 0 && (
                                  <div className="text-[9px] text-muted-foreground mt-1">
                                    {formatNum(legendSuicides)} suicides
                                  </div>
                                )}
                              </div>
                              <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="text-[9px] text-muted-foreground uppercase">Damage</div>
                                  <div className="text-[10px] font-bold text-foreground/70">
                                    {dmgRatio.toFixed(0)}% dealt
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div>
                                    <div className="text-lg font-black text-success">
                                      {formatCompact(legendDmgDealt)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">dealt</div>
                                  </div>
                                  <span className="text-muted-foreground/30 text-lg">/</span>
                                  <div>
                                    <div className="text-lg font-black text-danger">
                                      {formatCompact(legendDmgTaken)}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">taken</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Averages */}
                            <div className="grid grid-cols-4 gap-1 text-center">
                              <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                <div className="text-sm font-black text-foreground">{avgKOsPerGame.toFixed(1)}</div>
                                <div className="text-[8px] text-muted-foreground">KOs/game</div>
                              </div>
                              <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                <div className="text-sm font-black text-foreground">{avgFallsPerGame.toFixed(1)}</div>
                                <div className="text-[8px] text-muted-foreground">Falls/game</div>
                              </div>
                              <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                <div className="text-sm font-black text-foreground">
                                  {legendKOs > 0 ? formatNum(Math.round(legendDmgDealt / legendKOs)) : '\u2014'}
                                </div>
                                <div className="text-[8px] text-muted-foreground">Dmg/KO</div>
                              </div>
                              <div className="p-1.5 rounded bg-background/20 hover:bg-background/30 transition-colors">
                                <div className="text-sm font-black text-foreground">{dpsDealt.toFixed(1)}</div>
                                <div className="text-[8px] text-muted-foreground">DPS</div>
                              </div>
                            </div>
                          </div>

                          {/* Right Column: Ranked Season */}
                          <div className="space-y-3 md:pl-4">
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                              Ranked Season
                            </div>

                            {rankedLegend ? (
                              (() => {
                                const rankedWinrate =
                                  rankedLegend.games > 0 ? (rankedLegend.wins / rankedLegend.games) * 100 : 0
                                return (
                                  <div className="space-y-3 mt-7">
                                    <div className="flex gap-3">
                                      {/* Rank Banner */}
                                      <div className="w-16 sm:w-18 shrink-0 mb-5">
                                        <img
                                          src={getRankBanner(rankedLegend.tier)}
                                          alt={rankedLegend.tier}
                                          className="w-full h-auto object-contain drop-shadow-lg"
                                        />
                                      </div>

                                      {/* Rating Stats */}
                                      <div className="flex-1 min-w-0 space-y-1">
                                        <div className="text-[10px] sm:text-xs font-bold text-muted-foreground">
                                          {rankedLegend.tier}
                                        </div>
                                        <div className="flex items-baseline gap-1 flex-wrap">
                                          <span className="text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-none">
                                            {rankedLegend.rating}
                                          </span>
                                          <span className="text-xl sm:text-2xl font-bold text-muted-foreground/30 leading-none">
                                            /
                                          </span>
                                          <span className="text-xl sm:text-2xl font-bold text-muted-foreground/50 leading-none">
                                            {rankedLegend.peakRating}
                                          </span>
                                          <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider ml-0.5">
                                            Peak
                                          </span>
                                        </div>
                                        <WinLossBar percent={rankedWinrate} className="h-2" />
                                        <div className="flex justify-between text-[10px] font-bold">
                                          <span className="text-foreground">
                                            {rankedLegend.wins}W{' '}
                                            <span className="font-normal text-muted-foreground">
                                              ({rankedWinrate.toFixed(1)}%)
                                            </span>
                                          </span>
                                          <span className="text-foreground">
                                            {rankedLegend.games - rankedLegend.wins}L{' '}
                                            <span className="font-normal text-muted-foreground">
                                              ({(100 - rankedWinrate).toFixed(1)}%)
                                            </span>
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Ranked Stats Row */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                        <div className="text-lg font-black text-foreground">
                                          {formatNum(rankedLegend.games)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground uppercase">Games</div>
                                      </div>
                                      <div className="p-2.5 rounded-lg bg-background/40 border border-border/20 text-center hover:bg-background/50 transition-colors">
                                        <div className="text-lg font-black text-foreground">
                                          {calculateEloReset(rankedLegend.rating)}
                                        </div>
                                        <div className="text-[8px] text-muted-foreground uppercase">Elo Reset</div>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })()
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="w-16 sm:w-20 opacity-30 mb-3">
                                  <img
                                    src="/images/banners/Unranked.png"
                                    alt="Unranked"
                                    className="w-full h-auto object-contain"
                                  />
                                </div>
                                <div className="text-sm text-muted-foreground">No ranked games this season</div>
                                <div className="text-[10px] text-muted-foreground/50 mt-1">
                                  Play ranked to see stats here
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Weapon Distribution Section */}
                        {weaponDistribution.length > 0 && (
                          <div className="pt-4 border-t border-border/30">
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
                              Weapon Distribution
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {weaponDistribution.map((w) => {
                                const kosPercent = totalWeaponKOs > 0 ? (w.kos / totalWeaponKOs) * 100 : 0
                                const dmgPercent = totalWeaponDmg > 0 ? (w.dmg / totalWeaponDmg) * 100 : 0
                                const timePercent = totalWeaponTime > 0 ? (w.time / totalWeaponTime) * 100 : 0
                                const weaponDps = w.time > 0 ? w.dmg / w.time : 0
                                const weaponTimeToKill = w.kos > 0 ? w.time / w.kos : 0

                                return (
                                  <div
                                    key={w.name}
                                    className="p-3 rounded-lg bg-background/40 border border-border/20 hover:bg-background/50 transition-colors"
                                  >
                                    {/* Header */}
                                    <div className="flex items-center gap-2 mb-3">
                                      {w.name !== 'Unarmed' && w.name !== 'Weapon 1' && w.name !== 'Weapon 2' && (
                                        <img
                                          src={getWeaponIcon(w.name)}
                                          alt={w.name}
                                          className="h-6 w-6 object-contain"
                                        />
                                      )}
                                      <span className="text-xs font-bold text-foreground uppercase">{w.name}</span>
                                    </div>

                                    {/* Stats */}
                                    <div className="space-y-2 text-[11px]">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">KOs</span>
                                        <span className="font-bold text-foreground">
                                          {formatNum(w.kos)}{' '}
                                          <span className="text-muted-foreground font-normal">
                                            ({kosPercent.toFixed(1)}%)
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Damage</span>
                                        <span className="font-bold text-foreground">
                                          {formatCompact(w.dmg)}{' '}
                                          <span className="text-muted-foreground font-normal">
                                            ({dmgPercent.toFixed(1)}%)
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Time held</span>
                                        <span className="font-bold text-foreground">
                                          {formatHours(w.time)}{' '}
                                          <span className="text-muted-foreground font-normal">
                                            ({timePercent.toFixed(1)}%)
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex justify-between pt-1 border-t border-border/20">
                                        <span className="text-muted-foreground">DPS</span>
                                        <span className="font-bold text-foreground">{weaponDps.toFixed(1)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Time to KO</span>
                                        <span className="font-bold text-foreground">
                                          {weaponTimeToKill.toFixed(1)}s
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </Card>

      {allLegends.length > 5 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggleLegends} className="gap-2">
            {showAllLegends ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Legends <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
