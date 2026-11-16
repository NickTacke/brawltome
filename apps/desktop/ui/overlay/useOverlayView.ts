import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'
import type { BannerSide } from './Overlay'
import type { OverlayView } from './overlay-view'

// what the app sends with each view: the cards are scaled to the monitor the game is on, and mirrored on its right
export type OverlayEnvelope = { view: OverlayView; monitorHeightPx: number; bannerSide: BannerSide }

export type OverlayViewState = {
  envelope: OverlayEnvelope | null
  openProfile: (brawlhallaId: number) => void
  retry: () => void
  reportSize: (lobbyId: number, widthPx: number, heightPx: number) => void
}

// the view the app shows right now, and the three things the page can tell the app
export function useOverlayView(): OverlayViewState {
  const [envelope, setEnvelope] = useState<OverlayEnvelope | null>(null)

  useRedrawWhenTheScaleChanges()
  useEffect(() => followTheApp(setEnvelope), [])

  const openProfile = useCallback((brawlhallaId: number) => send('open_player_profile', { brawlhallaId }), [])
  const retry = useCallback(() => send('retry_lookup'), [])

  const reportSize = useCallback((lobbyId: number, widthPx: number, heightPx: number) => {
    send('overlay_content_resized', { lobbyId, widthPx, heightPx, devicePixelRatio: window.devicePixelRatio })
  }, [])

  return { envelope, openProfile, retry, reportSize }
}

// listens first and asks second, so a view sent in between is never lost or overwritten by an older one
export function followTheApp(setEnvelope: (envelope: OverlayEnvelope | null) => void): () => void {
  let isDisposed = false
  let hasLiveEvent = false
  const unlisteners: UnlistenFn[] = []

  const start = async () => {
    const unlistenView = await listen<OverlayEnvelope>('overlay://view', ({ payload }) => {
      hasLiveEvent = true
      setEnvelope(payload)
    })

    const unlistenClear = await listen('overlay://clear', () => {
      hasLiveEvent = true
      setEnvelope(null)
    })

    unlisteners.push(unlistenView, unlistenClear)

    if (isDisposed) {
      stopListening(unlisteners)

      return
    }

    const current = await invoke<OverlayEnvelope | null>('get_overlay_view')

    if (isDisposed || hasLiveEvent) return

    setEnvelope(current)
  }

  start().catch((error: unknown) => console.warn('follow the overlay view:', error))

  return () => {
    isDisposed = true
    stopListening(unlisteners)
  }
}

function stopListening(unlisteners: UnlistenFn[]) {
  for (const unlisten of unlisteners.splice(0)) unlisten()
}

function send(command: string, args?: Record<string, unknown>) {
  invoke(command, args).catch((error: unknown) => console.warn(`${command}:`, error))
}

// the cards' zoom depends on the ratio, so a move to a monitor with another scale draws them again; the page then
// reports its new size and the app places the window again
function useRedrawWhenTheScaleChanges() {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio)

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const update = () => setRatio(window.devicePixelRatio)

    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [ratio])
}
