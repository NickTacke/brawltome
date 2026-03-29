import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

const MOCK_OPPONENTS: Opponent[] = [
  {
    brawlhallaId: 91913839,
    name: 'brawltome.app',
    rating: 1827,
    peakRating: 1827,
    playtime: 917.3,
    tier: 'Platinum',
    region: 'EU',
    legendKey: 'mordex',
    winRate: 62,
  },
  {
    brawlhallaId: 8301816,
    name: 'Straalman',
    rating: 0,
    peakRating: 0,
    playtime: 1532.6,
    tier: 'Unranked',
    region: 'EU',
    legendKey: 'bodvar',
    winRate: 38,
  },
]

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>(MOCK_OPPONENTS)
  const [matchType, setMatchType] = useState('Ranked 1v1')

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setMatchType(payload.isRanked ? 'Ranked 1v1' : 'Custom')
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
