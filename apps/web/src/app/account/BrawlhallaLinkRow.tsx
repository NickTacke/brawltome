'use client'

import { linkSteam } from '@/lib/auth'
import type { PrimaryPlayerVerificationStateContract } from '@brawltome/contracts'
import { Gamepad2, Loader2 } from 'lucide-react'

interface BrawlhallaLinkRowProps {
  state: PrimaryPlayerVerificationStateContract | null
  loading?: boolean
}

const statusCopy = {
  failed: 'No Brawlhalla account was found for that Steam account',
  conflict: 'This player is already verified by another account',
} as const

export function BrawlhallaLinkRow({ state, loading = false }: BrawlhallaLinkRowProps) {
  if (loading) return <StatusRow tone="neutral" message="Loading Primary Player..." pending />

  const primary = state?.primaryPlayer
  const latestAttempt = state?.attempts[0]

  return (
    <div className="space-y-4">
      {primary ? (
        <StatusRow
          tone="success"
          message={`${primary.name ?? `Player ${primary.brawlhallaId}`} · ID ${primary.brawlhallaId}`}
        />
      ) : latestAttempt?.status === 'pending' ? (
        <StatusRow tone="neutral" message="Verifying your Primary Player..." pending />
      ) : latestAttempt?.status === 'failed' || latestAttempt?.status === 'conflict' ? (
        <StatusRow
          tone={latestAttempt.status === 'failed' ? 'danger' : 'warning'}
          message={statusCopy[latestAttempt.status]}
          retry
        />
      ) : (
        <StatusRow
          tone="neutral"
          message="Verify through Steam to set your Primary Player"
          retry
          actionLabel="Verify"
        />
      )}

      {state && state.attempts.length > 0 && (
        <div className="border-border/50 border-t pt-3">
          <p className="text-muted-foreground mb-2 text-[10px] font-medium uppercase tracking-wider">
            Verification history
          </p>
          <ul className="space-y-1.5">
            {state.attempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="capitalize">{attempt.status}</span>
                <time className="text-muted-foreground" dateTime={attempt.startedAt}>
                  {new Date(attempt.startedAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface StatusRowProps {
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  message: string
  pending?: boolean
  retry?: boolean
  actionLabel?: string
}

const toneClasses = {
  neutral: 'bg-white/[0.06] text-muted-foreground',
  success: 'bg-emerald-500/10 text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-400',
  danger: 'bg-red-500/10 text-red-400',
} as const

function StatusRow({ tone, message, pending = false, retry = false, actionLabel = 'Try Again' }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`rounded-lg p-2 ${toneClasses[tone]}`}>
          <Gamepad2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Primary Player</p>
          <p className="text-muted-foreground truncate text-xs">{message}</p>
        </div>
      </div>
      {pending && <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />}
      {retry && (
        <button
          type="button"
          onClick={linkSteam}
          className="shrink-0 cursor-pointer rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
