import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

// a fast filter change shouldn't flash a skeleton, so it only counts as slow after a moment
export function useSlowNavigation(delayMs = 150): boolean {
  const isPending = useRouterState({ select: (state) => state.status === 'pending' })
  const [isSlow, setIsSlow] = useState(false)

  useEffect(() => {
    if (!isPending) {
      setIsSlow(false)

      return
    }

    const timer = setTimeout(() => setIsSlow(true), delayMs)

    return () => clearTimeout(timer)
  }, [isPending, delayMs])

  return isSlow
}
