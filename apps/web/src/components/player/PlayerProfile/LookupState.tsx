'use client'

import { NavBar } from '@/components/NavBar'
import type { ReactNode } from 'react'

interface LookupStateProps {
  errored: boolean
  turnstile: ReactNode
}

export function LookupState({ errored, turnstile }: LookupStateProps) {
  return (
    <div>
      <NavBar showBack />
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        {!errored && (
          <>
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p>Looking up player...</p>
          </>
        )}
        {errored && <p>Player not found.</p>}
        {turnstile}
      </div>
    </div>
  )
}
