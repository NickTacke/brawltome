'use client'

import { timeAgo } from '@/lib/utils'
import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'

const TICK_MS = 60_000

export function DataAge({ updatedAt }: { updatedAt: Date }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const intervalId = setInterval(() => setTick((tick) => tick + 1), TICK_MS)
    return () => clearInterval(intervalId)
  }, [])

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Updated{' '}
      <time dateTime={updatedAt.toISOString()} suppressHydrationWarning>
        {timeAgo(updatedAt)}
      </time>
    </span>
  )
}
