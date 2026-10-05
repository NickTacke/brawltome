'use client'

import { track } from '@/lib/analytics/browser'
import { useEffect } from 'react'

type DeadEndKind = '404' | 'player_not_found' | 'clan_not_found'

export function trackDeadEndOnce(kind: DeadEndKind, trackFn: typeof track): void {
  trackFn({ name: 'deadend', kind })
}

export function TrackDeadEnd({ kind }: { kind: DeadEndKind }) {
  useEffect(() => {
    trackDeadEndOnce(kind, track)
  }, [kind])
  return null
}
