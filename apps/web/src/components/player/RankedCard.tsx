'use client'

import { timeAgo } from '@/lib/utils'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { Badge, Card, CardContent, CardHeader } from '@brawltome/ui'
import { Clock } from 'lucide-react'
import { WinLossBar, getRankBanner } from './shared'

function freshnessWindow(seconds: number): string {
  const hours = seconds / 3_600
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

function observedDate(value: string): string {
  return value.slice(0, 10)
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono font-semibold text-foreground">{value}</dd>
    </div>
  )
}

interface RankedCardProps {
  currentSeason: PlayerRankedProfileContract | null
}

export function RankedCard({ currentSeason }: RankedCardProps) {
  const snapshot = currentSeason?.snapshot
  if (!currentSeason || !snapshot) {
    return (
      <section aria-labelledby="competitive-summary-heading">
        <Card className="bg-linear-to-br from-card to-background border-border">
          <CardHeader>
            <div className="flex justify-between items-center gap-4">
              <h2 id="competitive-summary-heading" className="text-lg font-bold text-foreground">
                Competitive Snapshot
              </h2>
              <Badge variant="outline">Unavailable</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Complete Current Season ranked facts have not been successfully observed. Rating, rank, and outcomes are
              omitted rather than shown as zero.
            </p>
            {currentSeason?.checkedAt && <p>Last checked {timeAgo(currentSeason.checkedAt)}.</p>}
            {currentSeason && <p>Freshness window: {freshnessWindow(currentSeason.freshForSeconds)}.</p>}
          </CardContent>
        </Card>
      </section>
    )
  }

  const oneVsOne = snapshot.oneVsOne
  const losses = oneVsOne.games - oneVsOne.wins
  const winRate = oneVsOne.games > 0 ? (oneVsOne.wins / oneVsOne.games) * 100 : null
  const direction = snapshot.observedRatingDirection
  const mainLegend = snapshot.mainLegend
  const pulse = currentSeason.sparsePulse

  return (
    <section aria-labelledby="competitive-summary-heading">
      <Card className="bg-linear-to-br from-card to-background border-border">
        <CardHeader className="pb-4">
          <div className="flex justify-between items-center gap-4">
            <h2 id="competitive-summary-heading" className="text-lg font-bold text-foreground">
              Competitive Snapshot
            </h2>
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {currentSeason.freshness === 'fresh' ? 'Updated' : 'Update delayed'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Complete ranked data last checked {timeAgo(currentSeason.checkedAt)}. Last successful update{' '}
            {currentSeason.lastSuccessAt ? timeAgo(currentSeason.lastSuccessAt) : 'unavailable'}. Freshness window:{' '}
            {freshnessWindow(currentSeason.freshForSeconds)}.
          </p>
        </CardHeader>

        <CardContent className="space-y-6 pt-2 pb-8">
          <div className="flex gap-4 sm:gap-6">
            <div className="w-16 sm:w-20 shrink-0">
              <img
                src={getRankBanner(oneVsOne.tier)}
                alt={`${oneVsOne.tier} rank banner`}
                className="w-full h-auto object-contain drop-shadow-lg"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-sm sm:text-base font-bold text-muted-foreground">{oneVsOne.tier}</p>
              <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap" aria-label="Current and peak rating">
                <span className="text-3xl sm:text-4xl font-black text-foreground tracking-tight leading-none">
                  {oneVsOne.rating}
                </span>
                <span aria-hidden="true" className="text-2xl sm:text-3xl font-bold text-muted-foreground/30">
                  /
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-muted-foreground/50">{oneVsOne.peakRating}</span>
                <span className="text-xs sm:text-sm font-bold text-muted-foreground uppercase tracking-wider">
                  Peak
                </span>
              </div>
              {winRate === null ? (
                <p className="text-sm text-muted-foreground">
                  Win rate unavailable until at least one game is observed.
                </p>
              ) : (
                <>
                  <WinLossBar percent={winRate} className="h-2.5 sm:h-3" />
                  <p className="text-sm font-semibold text-foreground">
                    {oneVsOne.wins} wins, {losses} losses ({winRate.toFixed(1)}%)
                  </p>
                </>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Region" value={oneVsOne.region} />
            {oneVsOne.globalRank !== null && <Fact label="Global rank" value={`#${oneVsOne.globalRank}`} />}
            {oneVsOne.regionRank !== null && <Fact label="Region rank" value={`#${oneVsOne.regionRank}`} />}
            {mainLegend && (
              <Fact
                label={mainLegend.source === 'career' ? 'Career-derived main legend' : 'Current Season main legend'}
                value={mainLegend.legendNameKey}
              />
            )}
          </dl>

          <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <h3 className="font-semibold text-foreground">BrawlTome-observed direction</h3>
            {direction ? (
              <>
                <p className="font-mono font-semibold text-foreground">
                  {direction.direction === 'up' ? 'Up' : direction.direction === 'down' ? 'Down' : 'Unchanged'}{' '}
                  {Math.abs(direction.ratingChange)} rating
                </p>
                <p className="text-muted-foreground">
                  Direction compares {direction.observationCount} of up to 365 retained BrawlTome complete-ranked
                  observations from {observedDate(direction.fromObservedAt)} to {observedDate(direction.toObservedAt)}
                  within the latest monotonic-games segment. Sparse pulse overlays are excluded. This is BrawlTome
                  coverage, not complete Elo history.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Unavailable until BrawlTome owns at least two complete-ranked observations in the latest monotonic-games
                segment. Sparse pulse overlays are excluded.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
            <h3 className="font-semibold text-foreground">Sparse pulse coverage</h3>
            {!pulse ? (
              <p>No sparse pulse observation is available. Complete Current Season freshness remains independent.</p>
            ) : pulse.lastSuccessAt ? (
              <p>
                At {observedDate(pulse.lastSuccessAt)}, a sparse pulse added at least one supported 1v1 or fixed-team
                scalar. It does not update complete rank, tier, region, legends, Solo Queue, team composition, or rating
                history.
              </p>
            ) : (
              <p>
                Last checked {observedDate(pulse.checkedAt)}. No supported scalar was observed, so last-known complete
                Current Season facts remain visible.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
