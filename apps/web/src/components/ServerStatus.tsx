'use client'

import { trpc } from '@/lib/trpc'
import { Skeleton } from '@brawltome/ui'
import { useEffect, useState } from 'react'

export function ServerStatus() {
  const [status, setStatus] = useState<{ tokens: number } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const data = await trpc.status.health.query()
        if (!cancelled) {
          setStatus(data)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    poll()
    const id = setInterval(poll, 10_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-destructive/50 bg-destructive/10 backdrop-blur-xs shadow-xs">
        <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
        <span className="text-xs font-medium text-destructive">Offline</span>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur-xs shadow-xs">
        <Skeleton className="h-2 w-2 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    )
  }

  let statusColor = 'bg-success'
  let statusText = 'Operational'
  if (status.tokens < 20) {
    statusColor = 'bg-destructive'
    statusText = 'High Load'
  } else if (status.tokens < 100) {
    statusColor = 'bg-yellow-500'
    statusText = 'Busy'
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-border bg-card/80 backdrop-blur-xs shadow-xs hover:bg-card/90 transition-colors">
      <div className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusColor}`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${statusColor}`} />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{statusText}</span>
    </div>
  )
}
