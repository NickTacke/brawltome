import { type ReactNode, useEffect, useRef, useState } from 'react'
import '../shared/tokens.css'
import './overlay.css'
import { cardScale } from './card-format'
import type { Card, OverlayView } from './overlay-view'
import { SoloCard } from './SoloCard'
import { TeamCard } from './TeamCard'

type OverlayProps = {
  view: OverlayView
  monitorHeightPx: number
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
  onResize: (widthPx: number, heightPx: number) => void
}

export function Overlay({ view, monitorHeightPx, onOpenProfile, onRetry, onResize }: OverlayProps) {
  const scale = cardScale(monitorHeightPx, globalThis.devicePixelRatio ?? 1)
  const cardsRef = useCardsSize(scale, onResize)
  const lobbyStartedAtMs = useLobbyStart(view.lobbyId)

  // keyed by lobby, so a newer answer for the same lobby keeps the bar where it is
  const timer = <TimerBar key={view.lobbyId} startedAtMs={lobbyStartedAtMs} visibleMs={view.visibleMs} />

  return (
    <div className="cards" ref={cardsRef} style={{ zoom: scale }}>
      {view.cards.map((card) => (
        <OverlayCard
          key={cardKey(card)}
          card={card}
          deferredProfileIds={view.deferredProfileIds}
          timer={timer}
          onOpenProfile={onOpenProfile}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}

type OverlayCardProps = {
  card: Card
  deferredProfileIds: number[]
  timer: ReactNode
  onOpenProfile: (brawlhallaId: number) => void
  onRetry: () => void
}

function OverlayCard({ card, deferredProfileIds, timer, onOpenProfile, onRetry }: OverlayCardProps) {
  if (card.kind === 'team') {
    return (
      <TeamCard
        data={card.data}
        players={card.players}
        deferredProfileIds={deferredProfileIds}
        timer={timer}
        onOpenProfile={onOpenProfile}
        onRetry={onRetry}
      />
    )
  }

  return (
    <SoloCard
      player={card.player}
      data={card.data}
      isDeferred={deferredProfileIds.includes(card.player.brawlhallaId)}
      timer={timer}
      onOpenProfile={onOpenProfile}
      onRetry={onRetry}
    />
  )
}

// when the cards of this lobby first showed, on the performance.now() clock
function useLobbyStart(lobbyId: number): number {
  const lobbyStartRef = useRef<{ lobbyId: number; startedAtMs: number } | null>(null)

  if (lobbyStartRef.current?.lobbyId !== lobbyId) {
    lobbyStartRef.current = { lobbyId, startedAtMs: performance.now() }
  }

  return lobbyStartRef.current.startedAtMs
}

type TimerBarProps = { startedAtMs: number; visibleMs: number }

// a card that turns from a failed div into a button is a new element, so the bar starts where the lobby's time
// already is instead of from full
function TimerBar({ startedAtMs, visibleMs }: TimerBarProps) {
  const [delayMs] = useState(() => Math.round(startedAtMs - performance.now()))

  return (
    <span className="timer">
      <i style={{ animationDuration: `${visibleMs}ms`, animationDelay: `${delayMs}ms` }} />
    </span>
  )
}

function cardKey(card: Card): string {
  return card.kind === 'team' ? `team-${card.team}` : `solo-${card.player.brawlhallaId}`
}

// reports the size the cards take on screen, so the window can be cut to exactly that
function useCardsSize(scale: number, onResize: OverlayProps['onResize']) {
  const cardsRef = useRef<HTMLDivElement>(null)
  const onResizeRef = useRef(onResize)

  onResizeRef.current = onResize

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new zoom resizes the cards on screen but not the box the observer watches, so it observes again
  useEffect(() => {
    const cards = cardsRef.current

    if (cards === null) return

    // the bounding box includes the zoom, the observer's own sizes don't
    const observer = new ResizeObserver(() => {
      const box = cards.getBoundingClientRect()

      onResizeRef.current(box.width, box.height)
    })

    // observing reports the size once at the start
    observer.observe(cards)

    return () => observer.disconnect()
  }, [scale])

  return cardsRef
}
