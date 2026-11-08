'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics/browser'

// Only definitive dead ends are tracked here; polling timeouts are already counted as refresh.state 'timed_out'.
type DeadEndKind = '404'

export function trackDeadEndOnce(kind: DeadEndKind, trackFn: typeof track): void {
  trackFn({ name: 'deadend', kind })
}

export function TrackDeadEnd({ kind }: { kind: DeadEndKind }) {
  useEffect(() => {
    trackDeadEndOnce(kind, track)
  }, [kind])

  return null
}
