import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Overlay } from './Overlay'
import { useOverlayView } from './useOverlayView'

const root = document.getElementById('root') as HTMLElement

function OverlayPage() {
  const { envelope, openProfile, retry, reportSize } = useOverlayView()

  // nothing stays mounted between lobbies, so a lobby shown again starts with a full timer bar
  if (envelope === null) return null

  const { view, monitorHeightPx } = envelope

  return (
    <Overlay
      view={view}
      monitorHeightPx={monitorHeightPx}
      onOpenProfile={openProfile}
      onRetry={retry}
      onResize={(widthPx, heightPx) => reportSize(view.lobbyId, widthPx, heightPx)}
    />
  )
}

createRoot(root).render(
  <StrictMode>
    <OverlayPage />
  </StrictMode>,
)
