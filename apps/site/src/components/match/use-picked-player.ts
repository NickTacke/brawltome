import type { MatchInsights } from '@brawltome/contracts'
import { useMemo, useState } from 'react'
import { type MatchPlayer, matchPlayersOf } from './match-players'

type Picked = { players: MatchPlayer[]; picked: MatchPlayer | undefined; pick: (slot: number) => void }

/** The players of a match and the one the page is turned towards: the first until another is picked. */
export function usePickedPlayer(insights: MatchInsights): Picked {
  const players = useMemo(() => matchPlayersOf(insights), [insights])
  const [pickedSlot, setPickedSlot] = useState<number | null>(null)
  const picked = players.find((entry) => entry.slot === pickedSlot) ?? players[0]

  return { players, picked, pick: setPickedSlot }
}
