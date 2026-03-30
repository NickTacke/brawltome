import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

const AUTO_HIDE_MS = 10_000

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [matchType, setMatchType] = useState('Players')
  const [visible, setVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitCountRef = useRef(0)

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setMatchType(payload.isRanked ? 'Players' : 'Custom')
        setVisible(true)

        emitCountRef.current += 1
        // First emit = initial (possibly stale) data, show refreshing
        // Second emit = re-fetched data, hide refreshing
        setRefreshing(emitCountRef.current <= 1)

        // Start auto-hide timer only on first emit (don't reset on updates)
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            setVisible(false)
            timerRef.current = null
          }, AUTO_HIDE_MS)
        }
      } else if (payload.event === 'match_ended') {
        setOpponents([])
        setVisible(false)
        setRefreshing(false)
        emitCountRef.current = 0
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }
    })

    return () => {
      unlisten.then((fn) => fn())
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { opponents, matchType, visible, refreshing }
}
