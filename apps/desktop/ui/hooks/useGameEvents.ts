import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useEffect, useRef, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

const AUTO_HIDE_MS = 30_000

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appWindow = getCurrentWebviewWindow()

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setVisible(true)
        appWindow.show()

        timerRef.current = setTimeout(() => {
          setVisible(false)
          appWindow.hide()
        }, AUTO_HIDE_MS)
      } else if (payload.event === 'match_ended') {
        setVisible(false)
        appWindow.hide()
      }
    })

    return () => {
      unlisten.then((fn) => fn())
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [appWindow])

  return { opponents, visible }
}
