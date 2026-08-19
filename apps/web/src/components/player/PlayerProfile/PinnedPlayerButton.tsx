'use client'

import { Pin } from 'lucide-react'

interface PinnedPlayerButtonProps {
  pinned: boolean
  pending: boolean
  disabled?: boolean
  onToggle: () => void
}

export function PinnedPlayerButton({ pinned, pending, disabled = false, onToggle }: PinnedPlayerButtonProps) {
  const limitLabel = disabled && !pending && !pinned ? 'Pinned Players limit reached' : undefined

  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-busy={pending}
      aria-label={limitLabel}
      disabled={pending || disabled}
      onClick={onToggle}
      className="bg-card text-foreground hover:bg-muted focus-visible:ring-primary inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
    >
      <Pin className="h-4 w-4" aria-hidden="true" />
      {pending ? 'Updating Pinned Players...' : pinned ? 'Unpin' : 'Pin'}
    </button>
  )
}
