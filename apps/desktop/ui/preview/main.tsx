import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

// each page loads on its own, so the overlay's styles never leak into the window's preview or back
const OverlayPreview = lazy(() => import('./OverlayPreview').then((module) => ({ default: module.OverlayPreview })))
const WindowPreview = lazy(() => import('./WindowPreview').then((module) => ({ default: module.WindowPreview })))

// dev-only: vite serves preview.html, the app build never includes it
const params = new URLSearchParams(window.location.search)
const page = params.get('page') ?? 'overlay'
const root = document.getElementById('root') as HTMLElement

function PreviewPage() {
  if (page === 'overlay') {
    const side = params.get('side') === 'right' ? 'right' : 'left'

    return <OverlayPreview card={params.get('card') ?? 'solo-ranked'} bannerSide={side} />
  }

  if (page === 'window') return <WindowPreview status={params.get('status') ?? 'ready'} />

  return <p className="preview-missing">No preview page named {page}</p>
}

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>
      <PreviewPage />
    </Suspense>
  </StrictMode>,
)
