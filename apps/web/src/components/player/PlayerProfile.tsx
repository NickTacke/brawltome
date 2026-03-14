'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { fixEncoding, formatNum, timeAgo } from '@/lib/utils'
import { NavBar } from '@/components/NavBar'
import { RatingChart } from './RatingChart'
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Avatar, AvatarFallback, AvatarImage,
  Button, Progress, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@brawltome/ui'
import { ChevronDown, ChevronUp, Clock } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlayerData = any

const getRankBanner = (tier?: string | null) => {
  if (!tier) return '/images/banners/Unranked.png'
  const parts = tier.split(' ')
  const baseTier = parts[0]
  const subdivision = parts[1]
  if (baseTier === 'Diamond') return '/images/banners/Diamond.png'
  if (baseTier === 'Valhallan') return '/images/banners/Valhallan.png'
  const tiersWithSubs = ['Tin', 'Bronze', 'Silver', 'Gold', 'Platinum']
  if (tiersWithSubs.includes(baseTier) && subdivision !== undefined)
    return `/images/banners/${baseTier}%20${subdivision}.png`
  if (tiersWithSubs.includes(baseTier)) return `/images/banners/${baseTier}.png`
  return '/images/banners/Unranked.png'
}

const getWeaponIcon = (weapon: string) => `/images/weapons/${weapon}.png`

const getGloryFromWins = (wins: number): number => {
  if (wins <= 150) return 20 * wins
  return Math.floor(10 * (45 * Math.pow(Math.log10(wins * 2), 2)) + 245)
}

const getGloryFromBestRating = (bestRating: number): number => {
  if (bestRating < 1200) return 250
  if (bestRating < 1286) return Math.floor(10 * (25 + 0.872093023 * (86 - (1286 - bestRating))))
  if (bestRating < 1390) return Math.floor(10 * (100 + 0.721153846 * (104 - (1390 - bestRating))))
  if (bestRating < 1680) return Math.floor(10 * (187 + 0.389655172 * (290 - (1680 - bestRating))))
  if (bestRating < 2000) return Math.floor(10 * (300 + 0.428125 * (320 - (2000 - bestRating))))
  if (bestRating < 2300) return Math.floor(10 * (437 + 0.143333333 * (300 - (2300 - bestRating))))
  return Math.floor(10 * (480 + 0.05 * (400 - (2700 - bestRating))))
}

const calculateGlory = (wins: number, peakRating: number) => getGloryFromWins(wins) + getGloryFromBestRating(peakRating)
const calculateEloReset = (rating: number) => rating < 1400 ? rating : Math.floor(1400 + (rating - 1400) / (3 - (3000 - rating) / 800))

const formatHours = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0))
  const hoursRaw = seconds / 3600
  const hoursRounded = Math.round(hoursRaw * 10) / 10
  return Number.isInteger(hoursRounded) ? `${hoursRounded}h` : `${hoursRounded.toFixed(1)}h`
}

const WinLossBar = ({ percent, className }: { percent: number; className?: string }) => {
  const clamped = Math.max(0, Math.min(100, percent || 0))
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-danger-muted ${className || ''}`}>
      <div className="h-full bg-success transition-all" style={{ width: `${clamped}%` }} />
    </div>
  )
}

interface PlayerProfileProps {
  initialData: PlayerData
  id: string
}

export function PlayerProfile({ initialData, id }: PlayerProfileProps) {
  const [player, setPlayer] = useState<PlayerData>(initialData)
  const [showAllLegends, setShowAllLegends] = useState(false)
  const [showAllWeapons, setShowAllWeapons] = useState(false)
  const legendsRef = useRef<HTMLDivElement>(null)
  const weaponsRef = useRef<HTMLDivElement>(null)

  // Poll while refreshing
  useEffect(() => {
    if (!player?.isRefreshing) return
    const id = setInterval(async () => {
      try {
        const data = await trpc.player.byId.query({ id: Number(player.brawlhallaId) })
        if (data) setPlayer(data)
        if (!data?.isRefreshing) clearInterval(id)
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(id)
  }, [player?.isRefreshing, player?.brawlhallaId])

  if (!player) {
    return <div className="max-w-6xl mx-auto p-6"><div className="text-muted-foreground">Player not found.</div></div>
  }

  const allLegends = [...(player.statsLegends || [])].sort((a: PlayerData, b: PlayerData) => (b.xp ?? 0) - (a.xp ?? 0))
  const displayedLegends = showAllLegends ? allLegends : allLegends.slice(0, 5)
  const rankedTeams = [...(player.rankedTeams || [])].sort((a: PlayerData, b: PlayerData) => (b.rating ?? 0) - (a.rating ?? 0))
  const weaponStats = player.weaponStats || []
  const displayedWeapons = showAllWeapons ? weaponStats : weaponStats.slice(0, 5)
  const totalTimeHeld = weaponStats.reduce((sum: number, w: PlayerData) => sum + (w.timeHeld ?? 0), 0)

  const rankedWins = player.rankedWins ?? 0
  const rankedGames = player.rankedGames ?? 0
  const winrate = rankedGames > 0 ? (rankedWins / rankedGames) * 100 : 0
  const totalGames = player.totalGames ?? 0
  const totalWins = player.totalWins ?? 0
  const overallWinrate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0

  const aliases = (player.aliases || [])
    .map((a: PlayerData) => a?.value)
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
    .filter((v: string) => v.trim() !== player.name)
    .sort()

  const teamsTotalWins = rankedTeams.reduce((sum: number, t: PlayerData) => sum + (t.wins ?? 0), 0)
  const allRatings = [player.peakRating ?? 0, ...rankedTeams.map((t: PlayerData) => t.peakRating ?? 0)]
  const bestRating = Math.max(...allRatings, 0)
  const totalRankedWins = rankedWins + teamsTotalWins

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <NavBar showBack />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-6 min-w-0 w-full md:w-auto md:flex-1">
          {allLegends.length > 0 && (
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-4 border-card rounded-2xl shrink-0">
              <AvatarImage src={`/images/legends/avatars/${allLegends[0].legendNameKey}.png`} alt={allLegends[0].legendNameKey} className="object-cover object-top" />
              <AvatarFallback className="bg-muted text-xl sm:text-3xl font-bold text-muted-foreground capitalize rounded-2xl">
                {allLegends[0].legendNameKey?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-5xl sm:h-14 font-black text-foreground tracking-tight truncate">{fixEncoding(player.name)}</h1>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
              {player.region && <Badge variant="outline">{player.region}</Badge>}
              <span>•</span>
              <div>ID: <span className="font-mono text-foreground">{player.brawlhallaId}</span></div>
              {player.matchTimeTotal > 0 && (
                <><span>•</span><div>Playtime: <span className="font-mono text-foreground">{formatHours(player.matchTimeTotal)}</span></div></>
              )}
              {aliases.length > 0 && (
                <><span>•</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Aliases ({aliases.length})</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-[198px] overflow-y-auto">
                      {aliases.map((alias: string, idx: number) => <DropdownMenuItem key={`${alias}-${idx}`}>{fixEncoding(alias)}</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              {player.clan && (
                <><span>•</span><div>Clan: <Link href={`/clan/${player.clan.clanId}`} prefetch={false} className="text-primary font-bold hover:underline">{fixEncoding(player.clan.clanName)}</Link></div></>
              )}
            </div>
          </div>
        </div>
        {player.isRefreshing && (
          <Badge variant="secondary" className="gap-2 animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
            Syncing live data...
          </Badge>
        )}
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ranked Performance */}
        <Card className="bg-linear-to-br from-card to-background border-border">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg font-bold flex items-center gap-2">&#127942; Ranked Performance</CardTitle>
              {player.rankedLastUpdated && (
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
                  <Clock className="w-3 h-3" /><span className="hidden sm:inline">Updated </span>{timeAgo(player.rankedLastUpdated)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            <div className="flex gap-4 sm:gap-6">
              <div className="w-16 sm:w-20 shrink-0">
                <img src={getRankBanner(player.tier)} alt={player.tier || 'Unranked'} className="w-full h-auto object-contain drop-shadow-lg" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-sm sm:text-base font-bold text-muted-foreground">{player.tier || 'Unranked'}</div>
                <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
                  <span className="text-3xl sm:text-4xl font-black text-foreground tracking-tight leading-none">{player.rating}</span>
                  <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/30 leading-none">/</span>
                  <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/50 leading-none">{player.peakRating}</span>
                  <span className="text-xs sm:text-sm font-bold text-muted-foreground/50 uppercase tracking-wider ml-1">Peak</span>
                </div>
                <WinLossBar percent={winrate} className="h-2.5 sm:h-3" />
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-foreground">{rankedWins}W <span className="font-normal text-muted-foreground">({winrate.toFixed(2)}%)</span></span>
                  <span className="text-foreground">{rankedGames - rankedWins}L <span className="font-normal text-muted-foreground">({(100 - winrate).toFixed(2)}%)</span></span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-5 border-t border-border/50 text-center">
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Ranked Games</div>
                <div className="text-lg sm:text-xl font-black text-foreground">{formatNum(rankedGames)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Total Glory</div>
                <div className="text-lg sm:text-xl font-black text-foreground">{formatNum(calculateGlory(totalRankedWins, bestRating))}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Elo Reset</div>
                <div className="text-lg sm:text-xl font-black text-foreground">{calculateEloReset(player.rating)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Combat Record */}
        <Card className="bg-linear-to-br from-card to-background border-border">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl font-bold text-chart-3 flex items-center gap-2">&#128202; Combat Record</CardTitle>
              {player.statsLastUpdated && (
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
                  <Clock className="w-3 h-3" /><span className="hidden sm:inline">Updated </span>{timeAgo(player.statsLastUpdated)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">Account Level</div>
                  <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">{player.level ?? '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">Total Games</div>
                  <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">{formatNum(totalGames)}</div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Overall Win Rate</span>
                  <span className="text-foreground font-bold">{overallWinrate.toFixed(1)}%</span>
                </div>
                <WinLossBar percent={overallWinrate} className="h-3" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatNum(totalWins)} Wins</span>
                  <span>{formatNum(totalGames - totalWins)} Losses</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-6">
                <div>
                  <div className="text-lg font-bold text-foreground">{formatNum(player.xp)} <span className="text-xs text-muted-foreground font-normal">XP</span></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rating History Chart */}
      {player.ratingHistory && player.ratingHistory.length > 0 && (
        <RatingChart data={player.ratingHistory} />
      )}

      {/* Weapon Stats */}
      {weaponStats.length > 0 && (
        <div ref={weaponsRef} className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-foreground">Weapon Statistics</h2>
            <span className="text-sm text-muted-foreground font-mono">Total Weapons: {weaponStats.length}</span>
          </div>
          <Card className="overflow-hidden border-border">
            {displayedWeapons.map((w: PlayerData) => {
              const share = totalTimeHeld > 0 ? (w.timeHeld ?? 0) / totalTimeHeld : 0
              const formatCompact = (n: number | bigint): string => {
                const num = typeof n === 'bigint' ? Number(n) : n
                if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
                if (num >= 100_000) return `${(num / 1_000).toFixed(0)}K`
                if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`
                return formatNum(num)
              }
              return (
                <div key={w.weapon} className="transition-all duration-200 hover:bg-accent/30">
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
                              <span>{formatNum(w.kos)} KOs</span>
                              <span className="opacity-30">•</span>
                              <span>{formatCompact(w.damage)} dmg</span>
                            </div>
                          </div>
                          <div className="flex items-baseline gap-2 shrink-0">
                            <span className="text-lg font-black text-foreground leading-none">{formatHours(w.timeHeld)}</span>
                            <span className="text-sm font-bold text-primary">{(share * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="mt-[-4px] flex items-center gap-3">
                          <Progress value={share * 100} className="h-1.5 flex-1" />
                          <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {formatNum(w.kos)} KOs • {formatCompact(w.damage)} dmg
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </Card>
          {weaponStats.length > 5 && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={() => { if (showAllWeapons) weaponsRef.current?.scrollIntoView({ behavior: 'auto' }); setShowAllWeapons(!showAllWeapons) }} className="gap-2">
                {showAllWeapons ? <>Show Less <ChevronUp className="h-4 w-4" /></> : <>Show All Weapons <ChevronDown className="h-4 w-4" /></>}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Legends */}
      {allLegends.length > 0 && (
        <div id="legends-section" ref={legendsRef} className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-foreground">Legend Statistics</h2>
            <span className="text-sm text-muted-foreground font-mono">Played: {allLegends.length}</span>
          </div>
          <Card className="overflow-hidden border-border">
            {displayedLegends.map((legend: PlayerData) => {
              const wr = legend.games > 0 ? (legend.wins / legend.games) * 100 : 0
              const rankedLegend = (player.rankedLegends || []).find((r: PlayerData) => r.legendId === legend.legendId)
              return (
                <div key={legend.legendId} className="transition-all duration-200 hover:bg-accent/30">
                  <div className="p-4 space-y-3 relative overflow-hidden">
                    <div className="flex items-center gap-4 relative z-10">
                      <Avatar className="w-12 h-12 rounded-lg shadow-sm shrink-0">
                        <AvatarImage src={`/images/legends/avatars/${legend.legendNameKey}.png`} alt={legend.legendNameKey} className="object-cover object-top" loading="lazy" />
                        <AvatarFallback className="bg-muted text-lg font-bold text-muted-foreground capitalize rounded-md">{legend.legendNameKey?.[0] || '?'}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold capitalize truncate text-sm">{legend.legendNameKey}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
                          <span>{formatNum(legend.xp)} XP</span>
                          <span className="opacity-30">•</span>
                          <span className={wr > 50 ? 'text-success font-bold' : ''}>{wr.toFixed(0)}% WR</span>
                          <span className="opacity-30">•</span>
                          <span>{formatHours(legend.matchTime ?? 0)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs font-mono px-2 py-1 h-7">Lvl {legend.level}</Badge>
                        {rankedLegend && (
                          <Badge variant="outline" className="text-xs font-mono text-muted-foreground whitespace-nowrap px-2 py-1 h-7">
                            {rankedLegend.tier} • {rankedLegend.rating}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </Card>
          {allLegends.length > 5 && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={() => { if (showAllLegends) legendsRef.current?.scrollIntoView({ behavior: 'auto' }); setShowAllLegends(!showAllLegends) }} className="gap-2">
                {showAllLegends ? <>Show Less <ChevronUp className="h-4 w-4" /></> : <>Show All Legends <ChevronDown className="h-4 w-4" /></>}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 2v2 Teams */}
      {rankedTeams.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-foreground">2v2 Teams</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rankedTeams.map((t: PlayerData) => {
              const teamWinrate = t.games > 0 ? (t.wins / t.games) * 100 : 0
              const partnerId = t.brawlhallaIdOne === player.brawlhallaId ? t.brawlhallaIdTwo : t.brawlhallaIdOne
              const partnerName = t.teamName?.split('+')?.find((_: string, i: number) =>
                (i === 0 && t.brawlhallaIdOne !== player.brawlhallaId) || (i === 1 && t.brawlhallaIdTwo !== player.brawlhallaId)
              )?.trim() || 'Partner'
              return (
                <Card key={`${t.brawlhallaIdOne}-${t.brawlhallaIdTwo}`} className="overflow-hidden border-border">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <Link href={`/player/${partnerId}`} prefetch={false} className="font-bold text-foreground hover:text-primary transition-colors">
                          {fixEncoding(partnerName)}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-1">
                          {t.tier} • {t.region}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-foreground">{t.rating}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">Peak: {t.peakRating}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                      <span>{t.wins}W / {t.games - t.wins}L</span>
                      <span className={`font-bold ${teamWinrate >= 50 ? 'text-success' : ''}`}>{teamWinrate.toFixed(1)}%</span>
                    </div>
                    <WinLossBar percent={teamWinrate} className="h-1.5 mt-2" />
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
