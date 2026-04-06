import { useContentBounds } from '../hooks/useContentBounds'
import { useCursorForwarding } from '../hooks/useCursorForwarding'
import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  matchType: string
  visible: boolean
  scanning: boolean
  refreshing: boolean
}

function SkeletonCard() {
  return (
    <div className="w-[300px] rounded-lg border border-[hsla(var(--overlay-border)/0.7)] bg-[hsla(var(--overlay-bg)/0.82)] p-2.5 backdrop-blur-[12px]">
      <div className="flex items-center gap-2">
        <div className="size-[34px] shrink-0 animate-pulse rounded-[7px] bg-[hsl(var(--overlay-muted-bg))]" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-24 animate-pulse rounded bg-[hsl(var(--overlay-muted-bg))]" />
          <div className="h-2.5 w-16 animate-pulse rounded bg-[hsl(var(--overlay-muted-bg))]" />
        </div>
      </div>
      <div className="my-2 h-px bg-[hsla(var(--overlay-border)/0.5)]" />
      <div className="flex items-center justify-between px-1">
        <div className="h-4 w-20 animate-pulse rounded bg-[hsl(var(--overlay-muted-bg))]" />
        <div className="h-3 w-16 animate-pulse rounded bg-[hsl(var(--overlay-muted-bg))]" />
      </div>
    </div>
  )
}

export function OverlayPanel({ opponents, matchType, visible, scanning, refreshing }: OverlayPanelProps) {
  const panelRef = useContentBounds<HTMLDivElement>(visible)
  const { onMouseLeave } = useCursorForwarding()

  if (!visible) return null

  return (
    <div ref={panelRef} className="pointer-events-auto flex flex-col gap-1.5" onMouseLeave={onMouseLeave}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--overlay-muted-fg))]">
        {scanning ? 'Scanning...' : matchType}
      </p>
      {scanning ? (
        <SkeletonCard />
      ) : (
        <>
          {opponents.map((opponent) => (
            <OpponentCard key={opponent.brawlhallaId} opponent={opponent} refreshing={refreshing} />
          ))}
          {opponents.length > 0 && (
            <div className="mt-0.5 h-[3px] w-[300px] overflow-hidden rounded-full bg-[hsla(var(--overlay-muted-bg)/0.5)]">
              <div
                className="h-full rounded-full bg-[hsl(var(--overlay-primary))]"
                style={{ animation: 'countdown 10s linear forwards' }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
