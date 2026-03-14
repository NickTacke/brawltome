'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
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

interface RatingHistoryEntry {
  rating: number
  peakRating: number
  tier: string | null
  games: number
  wins: number
  recordedAt: string | Date
}

interface RatingChartProps {
  data: RatingHistoryEntry[]
}

const TIER_THRESHOLDS = [
  { rating: 2000, label: 'Diamond', color: '#60a5fa' },
  { rating: 1680, label: 'Platinum', color: '#a78bfa' },
  { rating: 1390, label: 'Gold', color: '#eab308' },
  { rating: 1130, label: 'Silver', color: '#94a3b8' },
  { rating: 910, label: 'Bronze', color: '#b45309' },
  { rating: 720, label: 'Tin', color: '#78716c' },
]

function CustomTooltip({
  active,
  payload,
  label,
}: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null

  const entry = payload[0]?.payload as RatingHistoryEntry & { date: string }
  if (!entry) return null

  const winrate = entry.games > 0 ? ((entry.wins / entry.games) * 100).toFixed(1) : '0'

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-sm space-y-1.5">
      <div className="font-bold text-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <span className="text-muted-foreground">Rating:</span>
        <span className="font-black text-foreground">{entry.rating}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
        <span className="text-muted-foreground">Peak:</span>
        <span className="font-bold text-foreground">{entry.peakRating}</span>
      </div>
      {entry.tier && <div className="text-xs text-muted-foreground">{entry.tier}</div>}
      <div className="text-xs text-muted-foreground border-t border-border pt-1.5 mt-1.5">
        {entry.wins}W / {entry.games - entry.wins}L ({winrate}%) &bull; {entry.games} games
      </div>
    </div>
  )
}

export function RatingChart({ data }: RatingChartProps) {
  const sorted = [...data]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map((entry) => ({
      ...entry,
      date: new Date(entry.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      timestamp: new Date(entry.recordedAt).getTime(),
    }))

  if (sorted.length < 2) return null

  const allRatings = sorted.flatMap((d) => [d.rating, d.peakRating])
  const minRating = Math.floor((Math.min(...allRatings) - 50) / 50) * 50
  const maxRating = Math.ceil((Math.max(...allRatings) + 50) / 50) * 50

  const visibleThresholds = TIER_THRESHOLDS.filter((t) => t.rating >= minRating && t.rating <= maxRating)

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-bold flex items-center gap-2">&#128200; Rating History</CardTitle>
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
                key={t.label}
                y={t.rating}
                stroke={t.color}
                strokeDasharray="6 4"
                strokeOpacity={0.4}
                label={{
                  value: `${t.label} (${t.rating})`,
                  position: 'insideTopLeft',
                  fill: t.color,
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.8,
                }}
              />
            ))}
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              interval="preserveStartEnd"
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
            <Tooltip content={<CustomTooltip />} />
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
