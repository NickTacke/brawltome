'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

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

export function RatingChart({ data }: RatingChartProps) {
  const sorted = [...data]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map((entry) => ({
      ...entry,
      date: new Date(entry.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      timestamp: new Date(entry.recordedAt).getTime(),
    }))

  if (sorted.length < 2) return null

  const minRating = Math.min(...sorted.map((d) => d.rating)) - 50
  const maxRating = Math.max(...sorted.map((d) => d.rating)) + 50

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">&#128200; Rating History</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={sorted}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} className="fill-muted-foreground" interval="preserveStartEnd" />
            <YAxis domain={[minRating, maxRating]} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--foreground))',
              }}
              formatter={(value: number, name: string) => {
                if (name === 'rating') return [value, 'Rating']
                return [value, name]
              }}
              labelFormatter={(label) => label}
            />
            <Line
              type="monotone"
              dataKey="rating"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
