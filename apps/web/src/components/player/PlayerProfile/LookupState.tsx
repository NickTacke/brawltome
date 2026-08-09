'use client'

import { NavBar } from '@/components/NavBar'
import type { ReactNode } from 'react'

interface LookupStateProps {
  errored: boolean
  message: string | null
  turnstile: ReactNode
}

export function LookupState({ errored, message, turnstile }: LookupStateProps) {
  return (
    <div>
      <NavBar showBack />
      <div
        // biome-ignore lint/a11y/useSemanticElements: role="status" with aria-live is the conventional non-form lookup pattern; <output> is for form result values.
        className="flex flex-col items-center justify-center py-20 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {!errored && !message && (
          <>
            <div
              className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4"
              aria-hidden="true"
            />
            <p>Looking up player...</p>
          </>
        )}
        {errored && <p>Player not found.</p>}
        {!errored && message && <p>{message}</p>}
        {turnstile}
      </div>
    </div>
  )
}
