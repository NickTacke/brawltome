import { useEffect, useState } from 'react'
import { Overlay } from '../overlay/Overlay'
import type { OverlayView } from '../overlay/overlay-view'
import { overlayFixture, type StateCell, stateCells, tierCells } from './fixtures'

const FRAME_HEIGHT_PX = 1080
const OVERLAY_TOP_PX = 24

type OverlayPreviewProps = { card: string }

// ?page=overlay&card=<fixture> draws one fixture over a game frame, &card=states draws them all, &card=tiers one
// 1v1 card per tier
export function OverlayPreview({ card }: OverlayPreviewProps) {
  if (card === 'states' || card === 'tiers') {
    return <StatesSheet cells={card === 'states' ? stateCells() : tierCells()} />
  }

  const view = overlayFixture(card)

  if (view === null) return <p className="preview-missing">No fixture named overlay-view-{card}.json</p>

  return <GameFrame view={view} />
}

// the frame scales with the window height like the game does, and the cards scale on their own the way the app
// scales them, so a wrong scale shows up as a card that drifts from the frame
function GameFrame({ view }: { view: OverlayView }) {
  const windowHeightPx = useWindowHeight()
  const scale = windowHeightPx / FRAME_HEIGHT_PX

  return (
    <>
      <div className="preview-frame" style={{ transform: `scale(${scale})` }}>
        <PreviewStage />
        <div className="preview-dim" />
      </div>
      <div className="preview-overlay" style={{ top: OVERLAY_TOP_PX * scale }}>
        <PreviewOverlay view={view} monitorHeightPx={windowHeightPx * window.devicePixelRatio} />
      </div>
    </>
  )
}

function useWindowHeight(): number {
  const [heightPx, setHeightPx] = useState(window.innerHeight)

  useEffect(() => {
    const update = () => setHeightPx(window.innerHeight)

    window.addEventListener('resize', update)

    return () => window.removeEventListener('resize', update)
  }, [])

  return heightPx
}

// the stage art is a local file, never committed, so the frame falls back to a gradient without it
function PreviewStage() {
  const [isMissing, setIsMissing] = useState(false)

  if (isMissing) return null

  return <img className="preview-stage" src="/preview-stage.png" alt="" onError={() => setIsMissing(true)} />
}

// the sheet draws every card at the size it has on a 1080p monitor
function StatesSheet({ cells }: { cells: StateCell[] }) {
  return (
    <div className="preview-sheet">
      {cells.map((cell) => (
        <div className="preview-cell" key={cell.title}>
          <h2>{cell.title}</h2>
          <PreviewOverlay view={cell.view} monitorHeightPx={FRAME_HEIGHT_PX * window.devicePixelRatio} />
        </div>
      ))}
    </div>
  )
}

function PreviewOverlay({ view, monitorHeightPx }: { view: OverlayView; monitorHeightPx: number }) {
  return (
    <Overlay
      view={view}
      monitorHeightPx={monitorHeightPx}
      onOpenProfile={(brawlhallaId) => console.info(`open profile ${brawlhallaId}`)}
      onRetry={() => console.info('retry')}
      onResize={(widthPx, heightPx) => {
        document.body.dataset.cardsSize = `${widthPx}x${heightPx}`
      }}
    />
  )
}
