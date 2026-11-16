import type { MatchInsights } from '@brawltome/contracts'
import type { MatchPlayer } from '../match-players'
import { MoveLeaders } from './MoveLeaders'
import { OpeningLists } from './OpeningLists'
import { PlayerHabits } from './PlayerHabits'

type MatchModulesProps = {
  insights: MatchInsights
  players: MatchPlayer[]
  picked: MatchPlayer
  onPick: (slot: number) => void
}

/** What sits under the replay: the numbers behind the moments, each with its own way into the replay. */
export function MatchModules({ insights, players, picked, onPick }: MatchModulesProps) {
  return (
    <>
      <PlayerHabits matchPlayer={picked} players={players} durationMs={insights.summary.durationMs} />
      <OpeningLists moments={insights.insights.moments} slot={picked.slot} />
      <MoveLeaders players={players} selectedSlot={picked.slot} onPick={onPick} />
    </>
  )
}
