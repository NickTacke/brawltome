'use client'

import { fixEncoding, formatNum, timeAgo } from '@/lib/utils'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { Badge, Card, CardContent } from '@brawltome/ui'
import { Clock } from 'lucide-react'
import Link from 'next/link'
import { WinLossBar, getRankBanner } from './shared'

type RankedSnapshot = NonNullable<PlayerRankedProfileContract['snapshot']>
type FixedTeam = RankedSnapshot['fixedTeams'][number]
type SoloQueueTeam = RankedSnapshot['soloQueue'][number] & {
  brawlhallaIdOne: number
  brawlhallaIdTwo: 0
}
export type RankedTeam = FixedTeam | SoloQueueTeam

interface TeamSectionProps {
  player: { name: string; rankedLastUpdated: string | null }
  rankedTeams: RankedTeam[]
  brawlhallaId: number
}

export function TeamSection({ player, rankedTeams, brawlhallaId }: TeamSectionProps) {
  if (!rankedTeams || rankedTeams.length === 0) return null

  const soloQueueRows = rankedTeams.filter((team) => {
    const teammateId = team.brawlhallaIdOne === brawlhallaId ? team.brawlhallaIdTwo : team.brawlhallaIdOne
    return teammateId === 0
  })
  const pairedTeams = rankedTeams.filter((t) => {
    const teammateId = t.brawlhallaIdOne === brawlhallaId ? t.brawlhallaIdTwo : t.brawlhallaIdOne
    return teammateId !== 0
  })

  const teamsTotals = pairedTeams.reduce(
    (acc: { games: number; wins: number }, team: RankedTeam) => {
      acc.games += team.games
      acc.wins += team.wins
      return acc
    },
    { games: 0, wins: 0 },
  )
  const teamsWinrate = teamsTotals.games > 0 ? (teamsTotals.wins / teamsTotals.games) * 100 : null

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h3 className="text-xl font-bold text-foreground">Ranked 2v2</h3>
        <div className="flex items-center gap-3">
          {player.rankedLastUpdated && (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              <span className="sr-only">Updated </span>
              <span className="hidden sm:inline" aria-hidden="true">
                Updated{' '}
              </span>
              {timeAgo(player.rankedLastUpdated)}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground font-mono">Fixed teams: {pairedTeams.length}</span>
        </div>
      </div>

      <Card className="bg-linear-to-br from-card to-background border-border">
        <CardContent className="pt-6">
          <div className={`flex ${soloQueueRows.length > 0 ? 'flex-col md:flex-row' : ''} gap-4 md:gap-6`}>
            {soloQueueRows.length > 0 && (
              <div className="flex-1 min-w-0 space-y-6">
                {soloQueueRows.map((soloQueue, index) => {
                  const winRate = soloQueue.games > 0 ? (soloQueue.wins / soloQueue.games) * 100 : null
                  return (
                    <div key={`${soloQueue.teamName}:${soloQueue.region}:${index}`} className="flex gap-4">
                      <div className="w-16 sm:w-20 shrink-0">
                        <img
                          src={getRankBanner(soloQueue.tier)}
                          alt={soloQueue.tier || 'Unranked'}
                          className="w-full h-auto object-contain drop-shadow-lg"
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="text-sm sm:text-base font-bold text-muted-foreground">
                          Solo Queue &middot; {soloQueue.tier}
                        </div>
                        <div className="flex items-baseline gap-1 flex-wrap">
                          <span className="text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-none">
                            {soloQueue.rating}
                          </span>
                          <span className="text-xl sm:text-2xl font-bold text-muted-foreground/30 leading-none">/</span>
                          <span className="text-xl sm:text-2xl font-bold text-muted-foreground/50 leading-none">
                            {soloQueue.peakRating}
                          </span>
                          <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider ml-0.5">
                            Peak
                          </span>
                        </div>
                        {winRate === null ? (
                          <p className="text-xs text-muted-foreground">Win rate unavailable</p>
                        ) : (
                          <>
                            <WinLossBar percent={winRate} className="h-2.5" />
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className="text-foreground">
                                {soloQueue.wins}W{' '}
                                <span className="font-normal text-muted-foreground">({winRate.toFixed(1)}%)</span>
                              </span>
                              <span className="text-foreground">
                                {soloQueue.games - soloQueue.wins}L{' '}
                                <span className="font-normal text-muted-foreground">
                                  ({(100 - winRate).toFixed(1)}%)
                                </span>
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {soloQueueRows.length > 0 && pairedTeams.length > 0 && (
              <div className="border-t md:border-t-0 md:border-l border-border/30" />
            )}

            {pairedTeams.length > 0 && (
              <div className="flex-1 min-w-0 space-y-1 sm:space-y-2">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 sm:mb-3">
                  Fixed Teams
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl sm:text-3xl font-black text-foreground">
                      {formatNum(teamsTotals.wins)}
                    </span>
                    <span className="text-xs sm:text-sm text-muted-foreground font-mono">
                      / {formatNum(teamsTotals.games)}
                    </span>
                  </div>
                  <span className="text-lg sm:text-2xl font-black text-foreground">
                    {teamsWinrate === null ? 'Unavailable' : `${teamsWinrate.toFixed(1)}%`}
                  </span>
                </div>
                {teamsWinrate !== null && <WinLossBar percent={teamsWinrate} className="h-2 sm:h-3" />}
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  <span>Wins / Games</span>
                  <span>Win Rate</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-x-4 md:gap-y-10">
        {pairedTeams.map((team) => {
          const teammateId = team.brawlhallaIdOne === brawlhallaId ? team.brawlhallaIdTwo : team.brawlhallaIdOne
          const teammateHref = `/player/${teammateId}`
          const bannerUrl = getRankBanner(team.tier)

          let teammateName = ''
          if (team.teamName) {
            const teamNameParts = fixEncoding(team.teamName).split('+')
            const teammateNameIndex = team.brawlhallaIdOne === brawlhallaId ? 1 : 0
            teammateName =
              teamNameParts[teammateNameIndex]?.trim() ||
              teamNameParts.find((part: string) => part.trim() !== fixEncoding(player.name))?.trim() ||
              ''
          }
          if (!teammateName) teammateName = `Player ${teammateId}`

          return (
            <Link
              key={`${team.brawlhallaIdOne}-${team.brawlhallaIdTwo}`}
              href={teammateHref}
              prefetch={false}
              className="group flex items-stretch rounded-xl bg-card border border-border hover:border-primary transition-colors cursor-pointer min-h-36 relative min-w-0"
            >
              {/* Rank Banner on Left - Bleeding Out */}
              <div className="absolute -top-0.5 left-2 sm:left-4 w-16 sm:w-24 h-[120%] z-20 pointer-events-none filter drop-shadow-xl">
                <div
                  className="w-full h-full bg-top bg-no-repeat bg-contain transition-transform duration-300"
                  style={{ backgroundImage: `url(${bannerUrl})` }}
                />
              </div>

              {/* Content Spacer for Banner */}
              <div className="w-20 sm:w-32 shrink-0" />

              {/* Content */}
              <div className="flex-1 p-3 sm:p-4 flex flex-col justify-between min-w-0 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-4">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <h4 className="font-bold text-foreground text-lg leading-tight group-hover:text-primary transition-colors truncate">
                      {teammateName}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono text-muted-foreground truncate">
                        Teammate ID: {teammateId}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-start sm:justify-end shrink-0 mt-2 sm:mt-0">
                    <div className="text-left sm:text-right shrink-0 flex items-baseline justify-start sm:justify-end gap-2 sm:block sm:gap-0">
                      <div className="text-xl sm:text-2xl font-black text-chart-3 leading-none whitespace-nowrap">
                        {team.rating}
                        <span className="text-xs sm:text-sm font-medium text-muted-foreground ml-1.5 align-baseline opacity-80">
                          / {team.peakRating}
                        </span>
                      </div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider sm:mt-1">
                        {team.tier}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Wins / Games
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-foreground font-mono font-bold">{team.wins}</span>
                      <span className="text-xs text-muted-foreground">/ {team.games}</span>
                    </div>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Win Rate
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        team.games > 0 && team.wins / team.games > 0.5 ? 'text-success' : 'text-foreground'
                      }`}
                    >
                      {team.games > 0 ? `${((team.wins / team.games) * 100).toFixed(1)}%` : 'Unavailable'}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
