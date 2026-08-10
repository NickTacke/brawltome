'use client'

import { Bookmark } from 'lucide-react'

interface SavedPlayerButtonProps {
  saved: boolean
  pending: boolean
  disabled?: boolean
  onToggle: () => void
}

export function SavedPlayerButton({ saved, pending, disabled = false, onToggle }: SavedPlayerButtonProps) {
  const label = disabled ? 'Saved Players limit reached' : saved ? 'Remove from Saved Players' : 'Save player'

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-busy={pending}
      disabled={pending || disabled}
      onClick={onToggle}
      className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-primary inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
    >
      <Bookmark className="h-4 w-4" aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
      {pending ? 'Updating Saved Players...' : label}
    </button>
  )
}
