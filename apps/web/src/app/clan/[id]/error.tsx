'use client'

import { useEffect } from 'react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ClanError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[clan route]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h2 className="text-2xl font-semibold">Something went wrong</h2>
      <p className="mt-2 text-muted-foreground">We couldn't load this clan. Please try again.</p>
      <button type="button" onClick={reset} className="mt-4 rounded-md border px-4 py-2 hover:bg-muted">
        Try again
      </button>
    </div>
  )
}
