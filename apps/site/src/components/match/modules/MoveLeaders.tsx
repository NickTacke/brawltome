import { useState } from 'react'
import { FilterSelect } from '../../FilterSelect'
import { sectionTitle } from '../../player/player-styles'
import type { MatchPlayer } from '../match-players'
import { type MoveSortKey, moveSortOptions } from './move-sorts'
import { PlayerMoves } from './PlayerMoves'

type MoveLeadersProps = { players: MatchPlayer[]; selectedSlot: number; onPick: (slot: number) => void }

/** Which weapons and moves did the work for every player: damage, and how many uses landed, best first. */
export function MoveLeaders({ players, selectedSlot, onPick }: MoveLeadersProps) {
  const [sort, setSort] = useState<MoveSortKey>('damage')
  const columns = players.length > 2 ? 'sm:grid-cols-2 2xl:grid-cols-4' : 'sm:grid-cols-2'

  return (
    <section aria-labelledby="weapons">
      <div className="flex items-center justify-between gap-4">
        <h2 id="weapons" className={sectionTitle}>
          Weapons
        </h2>
        <FilterSelect
          label="Sort"
          value={sort}
          options={moveSortOptions}
          onChange={(value) => setSort(value as MoveSortKey)}
        />
      </div>
      <div className={`mt-3 grid gap-x-10 gap-y-6 ${columns}`}>
        {players.map((matchPlayer) => (
          <PlayerMoves
            key={matchPlayer.slot}
            matchPlayer={matchPlayer}
            sort={sort}
            isPicked={matchPlayer.slot === selectedSlot}
            onPick={() => onPick(matchPlayer.slot)}
          />
        ))}
      </div>
    </section>
  )
}
