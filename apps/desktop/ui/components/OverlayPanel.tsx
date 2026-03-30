import { useCursorForwarding } from '../hooks/useCursorForwarding'
import { useContentBounds } from '../hooks/useContentBounds'
import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  matchType: string
  visible: boolean
  refreshing: boolean
}

export function OverlayPanel({ opponents, matchType, visible, refreshing }: OverlayPanelProps) {
  const panelRef = useContentBounds<HTMLDivElement>()
  const { onMouseLeave } = useCursorForwarding()

  if (!visible || opponents.length === 0) return null

  return (
    <div ref={panelRef} className="pointer-events-auto flex flex-col gap-1.5" onMouseLeave={onMouseLeave}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--overlay-muted-fg))]">
        {matchType}
      </p>
      {opponents.map((opponent) => (
        <OpponentCard key={opponent.brawlhallaId} opponent={opponent} refreshing={refreshing} />
      ))}
      <div className="mt-0.5 h-[3px] w-[300px] overflow-hidden rounded-full bg-[hsla(var(--overlay-muted-bg)/0.5)]">
        <div
          className="h-full rounded-full bg-[hsl(var(--overlay-primary))]"
          style={{ animation: 'countdown 10s linear forwards' }}
        />
      </div>
    </div>
  )
}
