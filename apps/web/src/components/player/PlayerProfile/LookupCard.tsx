'use client'

import { Button, Card, CardContent } from '@/components/ui'
import type { PlayerRefreshNotice } from '@/lib/player-refresh-status'
import { cn } from '@/lib/utils'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

export interface LookupCardProps {
  id: string
  notice: PlayerRefreshNotice | null
  onAction: () => void
  turnstile: ReactNode
}

export function LookupCard({ id, notice, onAction, turnstile }: LookupCardProps) {
  const Icon = notice?.tone === 'info' ? RefreshCw : AlertTriangle

  return (
    <Card className="w-full max-w-md">
      <CardContent
        // biome-ignore lint/a11y/useSemanticElements: role="status" with aria-live is the conventional non-form lookup pattern; <output> is for form result values.
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 p-8 text-center"
      >
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Player ID <span className="font-mono text-foreground">{id}</span>
        </p>
        {notice ? (
          <>
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full',
                notice.tone === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-foreground">{notice.title}</h1>
              <p className="text-sm text-muted-foreground">{notice.detail}</p>
            </div>
            {notice.action && (
              <Button size="sm" onClick={onAction}>
                {notice.action.label}
              </Button>
            )}
          </>
        ) : (
          <>
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Looking up player...</p>
              <p className="text-sm text-muted-foreground">Fetching the latest stats from Brawlhalla.</p>
            </div>
          </>
        )}
        {turnstile}
      </CardContent>
    </Card>
  )
}
