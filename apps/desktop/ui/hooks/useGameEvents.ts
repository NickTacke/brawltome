import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [matchType, setMatchType] = useState('Players')

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setMatchType(payload.isRanked ? 'Players' : 'Custom')
      } else if (payload.event === 'match_ended') {
        setOpponents([])
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  return { opponents, matchType }
}
