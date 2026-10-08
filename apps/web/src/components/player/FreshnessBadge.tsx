import { Badge } from '@/components/ui'
import { type SectionFreshness, freshnessLabel } from '@/lib/section-freshness'
import { Clock } from 'lucide-react'

/** How old a profile section's data is, and where it came from when that is the leaderboard crawl. */
export function FreshnessBadge({ freshness }: { freshness: SectionFreshness }) {
  const label = freshnessLabel(freshness)
  return (
    <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5 shrink-0">
      <Clock className="w-3 h-3" aria-hidden="true" />
      <span>
        <span className={label.compactPrefix ? 'sm:hidden' : 'sr-only sm:hidden'}>
          {`${label.compactPrefix ?? label.prefix} `}
        </span>
        <span className="hidden sm:inline">{label.prefix} </span>
        <time dateTime={new Date(freshness.at).toISOString()} suppressHydrationWarning>
          {label.age}
        </time>
      </span>
    </Badge>
  )
}
