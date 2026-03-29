import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  visible: boolean
}

export function OverlayPanel({ opponents, visible }: OverlayPanelProps) {
  if (!visible || opponents.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Opponents
      </p>
      {opponents.map((opponent) => (
        <OpponentCard key={opponent.brawlhallaId} opponent={opponent} />
      ))}
    </div>
  )
}
