'use client'

import { Button } from '@/components/ui'
import type { PlayerRefreshNotice } from '@/lib/player-refresh-status'
import { cn } from '@/lib/utils'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface RefreshStatusBannerProps {
  notice: PlayerRefreshNotice
  onAction: () => void
}

export function RefreshStatusBanner({ notice, onAction }: RefreshStatusBannerProps) {
  const warning = notice.tone === 'warning'
  const Icon = warning ? AlertTriangle : RefreshCw

  return (
    <output
      aria-live="polite"
      className={cn(
        'flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        warning
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-border bg-muted/30 text-muted-foreground',
      )}
    >
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{notice.title}.</span> {notice.detail}
        </span>
      </span>
      {notice.action && (
        <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={onAction}>
          {notice.action.label}
        </Button>
      )}
    </output>
  )
}
