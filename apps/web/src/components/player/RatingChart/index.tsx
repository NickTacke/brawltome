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
import { type ChartPoint, type RatingHistoryEntry, SEASONS, TIER_THRESHOLDS, prepareChartData } from './utils'

interface RatingChartProps {
  data: RatingHistoryEntry[]
}

export function RatingChart({ data }: RatingChartProps) {
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)

  const allSorted = useMemo(() => prepareChartData(data), [data])

  const seasonsAsc = useMemo(() => [...SEASONS].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), [])

  const availableSeasons = seasonsAsc.filter((season, i) => {
    const next = seasonsAsc[i + 1]
    const start = season.startsAt.getTime()
    const end = next ? next.startsAt.getTime() : Number.POSITIVE_INFINITY
    return allSorted.some((d) => d.timestamp >= start && d.timestamp < end)
  })

  const withSeasonDrops = useMemo(() => {
    const boundaries = new Set(seasonsAsc.filter((s) => s.startsAt.getTime() > 0).map((s) => s.startsAt.getTime()))
    const result: ChartPoint[] = []
    for (let i = 0; i < allSorted.length; i++) {
      const prev = result[result.length - 1]
      const curr = allSorted[i]
      if (prev) {
        for (const boundary of boundaries) {
          if (prev.timestamp < boundary && curr.timestamp >= boundary) {
            result.push({ ...prev, timestamp: boundary - 1 })
            result.push({ ...curr, timestamp: boundary })
            break
          }
        }
      }
      result.push(curr)
    }
    return result
  }, [allSorted, seasonsAsc])

  const sorted = useMemo(() => {
    if (!selectedSeason) return withSeasonDrops
    const idx = seasonsAsc.findIndex((s) => s.name === selectedSeason)
    if (idx === -1) return withSeasonDrops
    const season = seasonsAsc[idx]
    const next = seasonsAsc[idx + 1]
    const start = season.startsAt.getTime()
    const end = next ? next.startsAt.getTime() : Number.POSITIVE_INFINITY
    return withSeasonDrops.filter((d) => d.timestamp >= start && d.timestamp < end)
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

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg font-bold flex items-center gap-2">&#128200; Rating History</CardTitle>
          {availableSeasons.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant={selectedSeason === null ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs font-mono px-2.5"
                onClick={() => setSelectedSeason(null)}
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
                >
                  {s.name.replace('Season ', 'S')}
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}
