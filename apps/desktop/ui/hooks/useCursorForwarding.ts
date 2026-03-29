import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback } from 'react'

export function useCursorForwarding() {
  const appWindow = getCurrentWebviewWindow()

  const onMouseEnter = useCallback(() => {
    appWindow.setIgnoreCursorEvents(false)
  }, [appWindow])

  const onMouseLeave = useCallback(() => {
    appWindow.setIgnoreCursorEvents(true)
  }, [appWindow])

  return { onMouseEnter, onMouseLeave }
}
