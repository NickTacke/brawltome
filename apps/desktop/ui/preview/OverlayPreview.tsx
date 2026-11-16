import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { type BannerSide, Overlay } from '../overlay/Overlay'
import type { OverlayView } from '../overlay/overlay-view'
import { PostMatchCard } from '../overlay/PostMatchCard'
import type { PostMatchView } from '../overlay/post-match'
import { overlayFixture, type StateCell, stateCells, tierCells } from './fixtures'
import { postMatchCells } from './post-match-fixtures'

const FRAME_HEIGHT_PX = 1080
const OVERLAY_TOP_PX = 24

type OverlayPreviewProps = { card: string; bannerSide: BannerSide }

// ?page=overlay&card=<fixture> draws one fixture over a game frame, &card=states draws them all, &card=tiers one
// 1v1 card per tier; &side=right puts the cards in the middle of the right edge, mirrored like the app does there
export function OverlayPreview({ card, bannerSide }: OverlayPreviewProps) {
  if (card === 'post-match') return <PostMatchSheet bannerSide={bannerSide} />

  if (card === 'post-match-won') {
    const first = postMatchCells().find((cell) => cell.match.matchPage === 'ready')

    return (
      <GameFrame
        bannerSide={bannerSide}
        renderCards={() => <PostMatchCards match={first?.match} bannerSide={bannerSide} />}
      />
    )
  }

  if (card === 'states' || card === 'tiers') {
    return <StatesSheet cells={card === 'states' ? stateCells() : tierCells()} bannerSide={bannerSide} />
  }

  const view = overlayFixture(card)

  if (view === null) return <p className="preview-missing">No fixture named overlay-view-{card}.json</p>

  return (
    <GameFrame
      bannerSide={bannerSide}
      renderCards={(monitorHeightPx) => (
        <PreviewOverlay view={view} monitorHeightPx={monitorHeightPx} bannerSide={bannerSide} />
      )}
    />
  )
}

// the frame scales with the window height like the game does, and the cards scale on their own the way the app
// scales them, so a wrong scale shows up as a card that drifts from the frame
type GameFrameProps = { bannerSide: BannerSide; renderCards: (monitorHeightPx: number) => ReactNode }

function GameFrame({ bannerSide, renderCards }: GameFrameProps) {
  const windowHeightPx = useWindowHeight()
  const scale = windowHeightPx / FRAME_HEIGHT_PX

  return (
    <>
      <div className="preview-frame" style={{ transform: `scale(${scale})` }}>
        <PreviewStage />
        <div className="preview-dim" />
      </div>
      <div className="preview-overlay" data-side={bannerSide} style={overlayStyle(bannerSide, scale)}>
        {renderCards(windowHeightPx * window.devicePixelRatio)}
      </div>
    </>
  )
}

// the app's edge margin is the same 24 px at 1080p as the top offset, scaled with the frame; the right side is
// drawn in the middle of the right edge, the app's default spot
function overlayStyle(bannerSide: BannerSide, scale: number): CSSProperties {
  const edgePx = OVERLAY_TOP_PX * scale

  if (bannerSide === 'right') return { top: '50%', transform: 'translateY(-50%)', paddingRight: edgePx }

  return { top: edgePx }
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
function StatesSheet({ cells, bannerSide }: { cells: StateCell[]; bannerSide: BannerSide }) {
  return (
    <div className="preview-sheet">
      {cells.map((cell) => (
        <div className="preview-cell" key={cell.title}>
          <h2>{cell.title}</h2>
          <PreviewOverlay
            view={cell.view}
            monitorHeightPx={FRAME_HEIGHT_PX * window.devicePixelRatio}
            bannerSide={bannerSide}
          />
        </div>
      ))}
    </div>
  )
}

type PreviewOverlayProps = { view: OverlayView; monitorHeightPx: number; bannerSide: BannerSide }

function PreviewOverlay({ view, monitorHeightPx, bannerSide }: PreviewOverlayProps) {
  return (
    <Overlay
      view={view}
      monitorHeightPx={monitorHeightPx}
      bannerSide={bannerSide}
      onOpenProfile={(brawlhallaId) => console.info(`open profile ${brawlhallaId}`)}
      onRetry={() => console.info('retry')}
      onResize={(widthPx, heightPx) => {
        document.body.dataset.cardsSize = `${widthPx}x${heightPx}`
      }}
    />
  )
}

// the post-match card has no app data yet, so the preview draws it on its own at the 1080p size
function PostMatchSheet({ bannerSide }: { bannerSide: BannerSide }) {
  return (
    <div className="preview-sheet">
      {postMatchCells().map((cell) => (
        <div className="preview-cell" key={cell.title}>
          <h2>{cell.title}</h2>
          <PostMatchCards match={cell.match} bannerSide={bannerSide} />
        </div>
      ))}
    </div>
  )
}

type PostMatchCardsProps = { match: PostMatchView | undefined; bannerSide: BannerSide }

function PostMatchCards({ match, bannerSide }: PostMatchCardsProps) {
  if (match === undefined) return null

  return (
    <div className="cards" data-banner-side={bannerSide}>
      <PostMatchCard match={match} onOpenMatchPage={() => console.info('open match page')} />
    </div>
  )
}
