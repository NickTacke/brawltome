'use client'

import Link from 'next/link'

export type AuthView = 'signed-out' | 'unlinked' | 'linked'

const STATES: { label: string; value: AuthView | null }[] = [
  { label: 'Auto', value: null },
  { label: 'Signed-out', value: 'signed-out' },
  { label: 'Unlinked', value: 'unlinked' },
  { label: 'Linked', value: 'linked' },
]

export function PreviewToggle({ activeOverride }: { activeOverride: string | null }) {
  if (process.env.NODE_ENV === 'production') return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-lg border border-border bg-popover/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur-sm">
      <span className="px-1 font-bold uppercase tracking-wider text-muted-foreground/70">Preview</span>
      {STATES.map((s) => {
        const active = (activeOverride ?? null) === s.value
        const href = s.value ? `/learn?as=${s.value}` : '/learn'
        return (
          <Link
            key={s.label}
            href={href}
            className={`rounded px-2 py-0.5 font-medium transition-colors ${
              active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
    </div>
  )
}
