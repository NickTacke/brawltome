'use client'

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { formatNum, timeAgo } from '@/lib/utils'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import { type PlayerData, WinLossBar, getVirtualLevel, getXpForLevel, parseNum } from './shared'

interface CombatCardProps {
  player: PlayerData
  title?: string
}

export function CombatCard({ player, title = 'Combat Record' }: CombatCardProps) {
  const [isHoveringLevel, setIsHoveringLevel] = useState(false)

  const hasOutcomes = typeof player.totalGames === 'number' && typeof player.totalWins === 'number'
  const totalGames = hasOutcomes ? player.totalGames : 0
  const totalWins = hasOutcomes ? player.totalWins : 0
  const overallWinrate = totalGames > 0 ? (totalWins / totalGames) * 100 : null
  const level = player.level
  const hasXp = player.xp !== null && player.xp !== undefined

  return (
    <Card className="bg-linear-to-br from-card to-background border-border">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold text-chart-3 flex items-center gap-2">&#128202; {title}</CardTitle>
          {player.statsLastUpdated && (
            <Badge
              variant="outline"
              className="text-xs font-mono text-muted-foreground gap-1.5 hover:bg-muted/50 transition-colors"
            >
              <Clock className="w-3 h-3" />
              <span className="hidden sm:inline">Updated </span>
              {timeAgo(player.statsLastUpdated)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-6">
            <div
              className="relative cursor-help"
              onMouseEnter={() => setIsHoveringLevel(true)}
              onMouseLeave={() => setIsHoveringLevel(false)}
            >
              <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                Account Level
              </div>
              {level === null || level === undefined ? (
                <div className="text-lg font-bold text-muted-foreground mt-1">Unavailable</div>
              ) : level >= 100 && hasXp ? (
                (() => {
                  const totalXp = parseNum(player.xp)
                  const vLevel = getVirtualLevel(totalXp)
                  const floorLv = Math.floor(vLevel)
                  const xpAtFloor = getXpForLevel(floorLv)
                  const xpAtNext = getXpForLevel(floorLv + 1)
                  const progress = xpAtNext > xpAtFloor ? ((totalXp - xpAtFloor) / (xpAtNext - xpAtFloor)) * 100 : 0

                  if (isHoveringLevel) {
                    return (
                      <div className="animate-in fade-in zoom-in-95 duration-200">
                        <div className="text-2xl sm:text-3xl font-black text-primary mt-1">{floorLv}</div>
                        <div className="text-xs text-primary/80 mt-1 font-medium">
                          {Math.floor(progress)}% to next level
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div className="animate-in fade-in duration-200">
                      <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">{level}</div>
                      <div className="text-xs text-muted-foreground mt-1 underline decoration-dotted decoration-muted-foreground/50">
                        Max level reached
                      </div>
                    </div>
                  )
                })()
              ) : (
                <>
                  <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">{level}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {player.xpPercentage === null || player.xpPercentage === undefined
                      ? 'Progress unavailable'
                      : `${Math.floor(player.xpPercentage * 100)}% to next level`}
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wide">
                Total Games
              </div>
              <div className="text-2xl sm:text-3xl font-black text-foreground mt-1">
                {hasOutcomes ? formatNum(totalGames) : 'Unavailable'}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Overall Win Rate</span>
              <span className="text-foreground font-bold">
                {overallWinrate === null ? 'Unavailable' : `${overallWinrate.toFixed(1)}%`}
              </span>
            </div>
            {overallWinrate !== null && <WinLossBar percent={overallWinrate} className="h-3" />}
            <div className="flex justify-between text-xs text-muted-foreground">
              {hasOutcomes ? (
                <>
                  <span>{formatNum(totalWins)} Wins</span>
                  <span>{formatNum(totalGames - totalWins)} Losses</span>
                </>
              ) : (
                <span>Career outcomes have not been observed.</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-lg font-bold text-foreground">
                {hasXp ? formatNum(player.xp) : 'Unavailable'}{' '}
                <span className="text-xs text-muted-foreground font-normal">XP</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
