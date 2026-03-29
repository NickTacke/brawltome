import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback } from 'react'

const appWindow = getCurrentWebviewWindow()

export function useCursorForwarding() {
  const onMouseEnter = useCallback(() => {
    appWindow.setIgnoreCursorEvents(false)
  }, [])

  const onMouseLeave = useCallback(() => {
    appWindow.setIgnoreCursorEvents(true)
  }, [])

  return { onMouseEnter, onMouseLeave }
}
