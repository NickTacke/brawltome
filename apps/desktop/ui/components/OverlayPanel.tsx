import { useCursorForwarding } from '../hooks/useCursorForwarding'
import { useContentBounds } from '../hooks/useContentBounds'
import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  matchType: string
}

export function OverlayPanel({ opponents, matchType }: OverlayPanelProps) {
  const panelRef = useContentBounds<HTMLDivElement>()
  const { onMouseLeave } = useCursorForwarding()

  if (opponents.length === 0) return null

  return (
    <div ref={panelRef} className="pointer-events-auto flex flex-col gap-1.5" onMouseLeave={onMouseLeave}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--overlay-muted-fg))]">
        {matchType}
      </p>
      {opponents.map((opponent) => (
        <OpponentCard key={opponent.brawlhallaId} opponent={opponent} />
      ))}
    </div>
  )
}
