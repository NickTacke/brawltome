'use client'

import { Badge } from '@/components/ui'

export function StaleBadge() {
  return (
    <Badge variant="secondary" className="gap-2 animate-pulse">
      <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
      Checking for updates...
    </Badge>
  )
}
