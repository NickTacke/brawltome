import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useState } from 'react'
import type { AppStatus, OverlayPosition, Settings } from './app-status'

export type AppStatusState = {
  status: AppStatus | null
  settings: Settings | null
  nowMs: number
  openProfile: (brawlhallaId: number) => void
  resumeOverlay: () => void
  changeOverlayPosition: (position: OverlayPosition) => void
  changeStartsWithWindows: (isEnabled: boolean) => void
  minimize: () => void
  close: () => void
}

// what the app tells the window, and what the window can ask of it; the clock is read when something changes or
// the window gets focus, so nothing ticks while the window sits there
export function useAppStatus(): AppStatusState {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const showStatus = useCallback((next: AppStatus) => {
    setNowMs(Date.now())
    setStatus(next)
  }, [])

  // a refused call leaves the settings as they were
  const keepSettings = useCallback((saved: Settings | null) => {
    if (saved !== null) setSettings(saved)
  }, [])

  useEffect(() => followTheStatus(showStatus), [showStatus])
  useEffect(() => readTheClockOnFocus(setNowMs), [])

  useEffect(() => {
    ask<Settings>('get_settings').then(keepSettings)
  }, [keepSettings])

  const openProfile = useCallback((brawlhallaId: number) => {
    ask('open_player_profile', { brawlhallaId })
  }, [])

  const resumeOverlay = useCallback(() => {
    ask('set_overlay_paused', { isPaused: false })
  }, [])

  const changeOverlayPosition = useCallback(
    (position: OverlayPosition) => {
      ask<Settings>('set_overlay_position', { position }).then(keepSettings)
    },
    [keepSettings],
  )

  const changeStartsWithWindows = useCallback(
    (isEnabled: boolean) => {
      ask<Settings>('set_starts_with_windows', { isEnabled }).then(keepSettings)
    },
    [keepSettings],
  )

  const minimize = useCallback(() => {
    getCurrentWindow()
      .minimize()
      .catch((error: unknown) => console.warn('minimise the main window:', error))
  }, [])

  const close = useCallback(() => {
    ask('close_main_window')
  }, [])

  return {
    status,
    settings,
    nowMs,
    openProfile,
    resumeOverlay,
    changeOverlayPosition,
    changeStartsWithWindows,
    minimize,
    close,
  }
}

// listens first and asks second, so a status sent in between is never overwritten by an older one
function followTheStatus(showStatus: (status: AppStatus) => void): () => void {
  let isDisposed = false
  let hasLiveEvent = false
  let unlisten: UnlistenFn | null = null

  const start = async () => {
    unlisten = await listen<AppStatus>('app://status', ({ payload }) => {
      hasLiveEvent = true
      showStatus(payload)
    })

    if (isDisposed) {
      unlisten()

      return
    }

    const current = await invoke<AppStatus>('get_app_status')

    if (isDisposed || hasLiveEvent) return

    showStatus(current)
  }

  start().catch((error: unknown) => console.warn('follow the app status:', error))

  return () => {
    isDisposed = true
    unlisten?.()
  }
}

function readTheClockOnFocus(setNowMs: (nowMs: number) => void): () => void {
  const update = () => setNowMs(Date.now())

  window.addEventListener('focus', update)

  return () => window.removeEventListener('focus', update)
}

// null when the app refused; the app logs a refused setting change itself, as console.warn reaches no log in
// release builds
async function ask<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, args)
  } catch (error: unknown) {
    console.warn(`${command}:`, error)

    return null
  }
}
