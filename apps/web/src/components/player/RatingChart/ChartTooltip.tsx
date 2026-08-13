import type { TooltipContentProps } from 'recharts'
import type { ChartPoint } from './utils'

export function ChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null

  const entry = payload[0]?.payload as ChartPoint | undefined
  if (!entry) return null

  const winRate = entry.games > 0 ? ((entry.wins / entry.games) * 100).toFixed(1) : null

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg text-sm space-y-1.5">
      <div className="font-bold text-foreground">{entry.date}</div>
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
        {entry.wins}W / {entry.games - entry.wins}L &bull;{' '}
        {winRate === null ? 'Win rate unavailable' : `${winRate}% win rate`} &bull; {entry.games} games
      </div>
    </div>
  )
}
