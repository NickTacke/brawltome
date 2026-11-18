import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayPreview } from './OverlayPreview'

// dev-only: vite serves preview.html, the app build never includes it
const params = new URLSearchParams(window.location.search)
const page = params.get('page') ?? 'overlay'
const root = document.getElementById('root') as HTMLElement

function PreviewPage() {
  if (page === 'overlay') {
    const side = params.get('side') === 'right' ? 'right' : 'left'

    return <OverlayPreview card={params.get('card') ?? 'solo-ranked'} bannerSide={side} />
  }

  return <p className="preview-missing">No preview page named {page}</p>
}

createRoot(root).render(
  <StrictMode>
    <PreviewPage />
  </StrictMode>,
)
