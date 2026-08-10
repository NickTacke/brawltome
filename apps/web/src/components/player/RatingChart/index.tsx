'use client'

import { Button, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import {
  type ChartPoint,
  type RatingHistoryEntry,
  SEASONS,
  type SeasonDef,
  TIER_THRESHOLDS,
  prepareChartData,
} from './utils'

interface RatingChartProps {
  data: RatingHistoryEntry[]
}

function seasonRange(seasons: SeasonDef[], name: string): { start: number; end: number } | null {
  const index = seasons.findIndex((season) => season.name === name)
  if (index === -1) return null
  return {
    start: seasons[index].startsAt.getTime(),
    end: seasons[index + 1]?.startsAt.getTime() ?? Number.POSITIVE_INFINITY,
  }
}

export function RatingChart({ data }: RatingChartProps) {
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)

  const allSorted = useMemo(() => prepareChartData(data), [data])

  const seasonsAsc = useMemo(() => [...SEASONS].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), [])

  const availableSeasons = seasonsAsc.filter((season) => {
    const range = seasonRange(seasonsAsc, season.name)
    return range && allSorted.some((point) => point.timestamp >= range.start && point.timestamp < range.end)
  })

  const withSeasonDrops = useMemo(() => {
    const boundaries = seasonsAsc.filter((s) => s.startsAt.getTime() > 0).map((s) => s.startsAt.getTime())
    const result: ChartPoint[] = []
    for (let i = 0; i < allSorted.length; i++) {
      const prev = result[result.length - 1]
      const curr = allSorted[i]
      if (prev) {
        const crossed = boundaries.filter((b) => prev.timestamp < b && curr.timestamp >= b).sort((a, b) => a - b)
        for (const boundary of crossed) {
          result.push({ ...prev, timestamp: boundary - 1 })
          result.push({ ...curr, timestamp: boundary })
        }
      }
      result.push(curr)
    }
    return result
  }, [allSorted, seasonsAsc])

  const sorted = useMemo(() => {
    if (!selectedSeason) return withSeasonDrops
    const range = seasonRange(seasonsAsc, selectedSeason)
    if (!range) return withSeasonDrops
    return withSeasonDrops.filter((point) => point.timestamp >= range.start && point.timestamp < range.end)
  }, [selectedSeason, withSeasonDrops, seasonsAsc])

  const uniqueTicks = useMemo(() => {
    const seen = new Set<string>()
    return sorted
      .filter((d) => {
        if (seen.has(d.date)) return false
        seen.add(d.date)
        return true
      })
      .map((d) => d.timestamp)
  }, [sorted])

  if (sorted.length < 2) return null

  const allRatings = sorted.flatMap((d) => [d.rating, d.peakRating])
  const minRating = Math.floor((Math.min(...allRatings) - 50) / 50) * 50
  const maxRating = Math.ceil((Math.max(...allRatings) + 50) / 50) * 50

  const visibleThresholds = TIER_THRESHOLDS.filter((t) => t.minRating >= minRating && t.minRating <= maxRating)

  const firstTs = sorted[0].timestamp
  const lastTs = sorted[sorted.length - 1].timestamp
  const visibleSeasonBoundaries = seasonsAsc.filter((s) => {
    const ts = s.startsAt.getTime()
    return ts > 0 && ts >= firstTs && ts <= lastTs
  })

  const accessibleRange = selectedSeason ? seasonRange(seasonsAsc, selectedSeason) : null
  const accessibleObservations = accessibleRange
    ? allSorted.filter((point) => point.timestamp >= accessibleRange.start && point.timestamp < accessibleRange.end)
    : allSorted

  return (
    <figure aria-labelledby="rating-history-heading" aria-describedby="rating-history-coverage">
      <Card className="border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle id="rating-history-heading" className="text-lg font-bold flex items-center gap-2">
              &#128200; Rating History
            </CardTitle>
            {availableSeasons.length > 1 && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant={selectedSeason === null ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs font-mono px-2.5"
                  onClick={() => setSelectedSeason(null)}
                  aria-pressed={selectedSeason === null}
                >
                  All
                </Button>
                {[...availableSeasons].reverse().map((s) => (
                  <Button
                    key={s.name}
                    variant={selectedSeason === s.name ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs font-mono px-2.5"
                    onClick={() => setSelectedSeason(s.name)}
                    aria-pressed={selectedSeason === s.name}
                  >
                    {s.name.replace('Season ', 'S')}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <p id="rating-history-coverage" className="text-sm text-muted-foreground">
            The chart shows up to 365 retained BrawlTome complete-ranked observations. Dates mark successful
            observations, so gaps between them remain outside BrawlTome coverage.
          </p>
        </CardHeader>
        <CardContent>
          <div aria-hidden="true">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={sorted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="ratingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                {visibleThresholds.map((t) => (
                  <ReferenceLine
                    key={t.name}
                    y={t.minRating}
                    stroke={t.color}
                    strokeDasharray="6 4"
                    strokeOpacity={0.4}
                    label={{
                      value: `${t.name} (${t.minRating})`,
                      position: 'insideTopLeft',
                      fill: t.color,
                      fontSize: 11,
                      fontWeight: 600,
                      opacity: 0.8,
                    }}
                  />
                ))}
                {visibleSeasonBoundaries.map((s) => (
                  <ReferenceLine
                    key={s.name}
                    x={s.startsAt.getTime()}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{
                      value: s.name,
                      position: 'insideTopRight',
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: 11,
                      fontWeight: 600,
                      opacity: 0.8,
                    }}
                  />
                ))}
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={uniqueTicks}
                  tickFormatter={(ts: number) =>
                    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  }
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[minRating, maxRating]}
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="rating"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#ratingGradient)"
                  dot={false}
                  activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="peakRating"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.4}
                  dot={false}
                  activeDot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ol className="sr-only">
            {accessibleObservations.map((point) => (
              <li key={`${point.recordedAt.toString()}:${point.rating}:${point.games}`}>
                {point.date}: Rating {point.rating}, peak {point.peakRating},{' '}
                {point.games > 0 ? `${point.wins} wins in ${point.games} games` : 'win rate unavailable'}.
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </figure>
  )
}
