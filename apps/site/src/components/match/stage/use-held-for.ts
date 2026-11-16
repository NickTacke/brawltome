import { useEffect, useState } from 'react'

/** True once a condition has held for a while; false again as soon as it stops. */
export function useHeldFor(isOn: boolean, delayMs: number): boolean {
  const [isHeld, setIsHeld] = useState(false)

  useEffect(() => {
    if (!isOn) return setIsHeld(false)

    const timer = setTimeout(() => setIsHeld(true), delayMs)

    return () => clearTimeout(timer)
  }, [isOn, delayMs])

  return isHeld
}
