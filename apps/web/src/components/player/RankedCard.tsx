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
  const hasRating = typeof player.rating === 'number' && player.rating > 0
  const hasOutcomes = typeof player.rankedGames === 'number' && typeof player.rankedWins === 'number'
  const rankedGames = hasOutcomes ? player.rankedGames : 0
  const rankedWins = hasOutcomes ? player.rankedWins : 0
  const winrate = rankedGames > 0 ? (rankedWins / rankedGames) * 100 : null
  const teamsTotalWins = rankedTeams.reduce((sum, team) => sum + (team.wins ?? 0), 0)
  const knownPeaks = [player.peakRating, ...rankedTeams.map((team) => team.peakRating)].filter(
    (rating): rating is number => typeof rating === 'number' && rating > 0,
  )
  const bestRating = knownPeaks.length > 0 ? Math.max(...knownPeaks) : null
  const totalRankedWins = hasOutcomes ? rankedWins + teamsTotalWins : null

  return (
    <Card className="bg-linear-to-br from-card to-background border-border">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center gap-3">
          <CardTitle className="text-lg font-bold flex items-center gap-2">&#127942; Ranked Performance</CardTitle>
          {player.rankedLastUpdated ? (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              <span className="hidden sm:inline">Updated </span>
              {timeAgo(player.rankedLastUpdated)}
            </Badge>
          ) : player.legacyRating ? (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
              V2 snapshot
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-8 pt-6 pb-8">
        <div className="flex gap-4 sm:gap-6">
          <div className="w-16 sm:w-20 shrink-0">
            <img
              src={getRankBanner(player.tier)}
              alt={player.tier || 'Unranked'}
              className="w-full h-auto object-contain drop-shadow-lg"
            />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-sm sm:text-base font-bold text-muted-foreground">{player.tier || 'Unranked'}</div>
            {hasRating ? (
              <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
                <span className="text-3xl sm:text-4xl font-black text-foreground tracking-tight leading-none">
                  {player.rating}
                </span>
                {typeof player.peakRating === 'number' && player.peakRating > 0 && (
                  <>
                    <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/30 leading-none">/</span>
                    <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/50 leading-none">
                      {player.peakRating}
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-muted-foreground/50 uppercase tracking-wider ml-1">
                      Peak
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="text-2xl font-black text-muted-foreground">Rating unavailable</div>
            )}

            {winrate === null ? (
              <p className="text-sm text-muted-foreground">Current-season wins and losses are unavailable.</p>
            ) : (
              <>
                <WinLossBar percent={winrate} className="h-2.5 sm:h-3" />
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-foreground">
                    {rankedWins}W <span className="font-normal text-muted-foreground">({winrate.toFixed(2)}%)</span>
                  </span>
                  <span className="text-foreground">
                    {rankedGames - rankedWins}L{' '}
                    <span className="font-normal text-muted-foreground">({(100 - winrate).toFixed(2)}%)</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-5 border-t border-border/50 text-center">
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Ranked Games</div>
            <div className="text-lg sm:text-xl font-black text-foreground">
              {hasOutcomes ? formatNum(rankedGames) : '—'}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Total Glory</div>
            <div className="text-lg sm:text-xl font-black text-foreground">
              {totalRankedWins !== null && bestRating !== null
                ? formatNum(calculateGlory(totalRankedWins, bestRating))
                : '—'}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Elo Reset</div>
            <div className="text-lg sm:text-xl font-black text-foreground">
              {hasRating ? calculateEloReset(player.rating) : '—'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
