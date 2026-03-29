import { useEffect, useState } from 'react'
import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  visible: boolean
}

export function OverlayPanel({ opponents, visible }: OverlayPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (visible && opponents.length > 0) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setShow(true))
      })
    } else {
      setShow(false)
      const timer = setTimeout(() => setMounted(false), 300)
      return () => clearTimeout(timer)
    }
  }, [visible, opponents.length])

  if (!mounted) return null

  return (
    <div
      className="flex flex-col gap-2 transition-all duration-300"
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translateX(0)' : 'translateX(20px)',
      }}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Opponents
      </p>
      {opponents.map((opponent) => (
        <OpponentCard key={opponent.brawlhallaId} opponent={opponent} />
      ))}
    </div>
  )
}
