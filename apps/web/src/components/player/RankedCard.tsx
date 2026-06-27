'use client'

import { formatNum, timeAgo } from '@/lib/utils'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { Clock } from 'lucide-react'
import { type PlayerData, WinLossBar, calculateEloReset, calculateGlory, getRankBanner } from './shared'

interface RankedCardProps {
  player: PlayerData
  rankedTeams: PlayerData[]
}

export function RankedCard({ player, rankedTeams }: RankedCardProps) {
  const rankedWins = player.rankedWins ?? 0
  const rankedGames = player.rankedGames ?? 0
  const winrate = rankedGames > 0 ? (rankedWins / rankedGames) * 100 : 0

  const teamsTotalWins = rankedTeams.reduce((sum: number, t: PlayerData) => sum + (t.wins ?? 0), 0)
  const allRatings = [player.peakRating ?? 0, ...rankedTeams.map((t: PlayerData) => t.peakRating ?? 0)]
  const bestRating = Math.max(...allRatings, 0)
  const totalRankedWins = rankedWins + teamsTotalWins

  return (
    <Card className="bg-linear-to-br from-card to-background border-border">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg font-bold flex items-center gap-2">&#127942; Ranked Performance</CardTitle>
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
        </div>
      </CardHeader>

      <CardContent className="space-y-8 pt-6 pb-8">
        <div className="flex gap-4 sm:gap-6">
          {/* Rank Banner */}
          <div className="w-16 sm:w-20 shrink-0">
            <img
              src={getRankBanner(player.tier)}
              alt={player.tier || 'Unranked'}
              className="w-full h-auto object-contain drop-shadow-lg"
            />
          </div>

          {/* Stats */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Tier */}
            <div className="text-sm sm:text-base font-bold text-muted-foreground">{player.tier || 'Unranked'}</div>

            {/* ELO */}
            <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
              <span className="text-3xl sm:text-4xl font-black text-foreground tracking-tight leading-none">
                {player.rating}
              </span>
              <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/30 leading-none">/</span>
              <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/50 leading-none">
                {player.peakRating}
              </span>
              <span className="text-xs sm:text-sm font-bold text-muted-foreground/50 uppercase tracking-wider ml-1">
                Peak
              </span>
            </div>

            {/* Win Rate Bar */}
            <WinLossBar percent={winrate} className="h-2.5 sm:h-3" />

            {/* Win/Loss Stats */}
            <div className="flex justify-between text-sm font-bold">
              <span className="text-foreground">
                {rankedWins}W <span className="font-normal text-muted-foreground">({winrate.toFixed(2)}%)</span>
              </span>
              <span className="text-foreground">
                {rankedGames - rankedWins}L{' '}
                <span className="font-normal text-muted-foreground">({(100 - winrate).toFixed(2)}%)</span>
              </span>
            </div>
          </div>
        </div>

        {/* Season Rewards */}
        <div className="grid grid-cols-3 gap-3 pt-5 border-t border-border/50 text-center">
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Ranked Games</div>
            <div className="text-lg sm:text-xl font-black text-foreground">{formatNum(rankedGames)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Total Glory</div>
            <div className="text-lg sm:text-xl font-black text-foreground">
              {formatNum(calculateGlory(totalRankedWins, bestRating))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Elo Reset</div>
            <div className="text-lg sm:text-xl font-black text-foreground">{calculateEloReset(player.rating)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
