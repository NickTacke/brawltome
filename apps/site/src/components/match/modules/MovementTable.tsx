import { sectionTitle } from '../../player/player-styles'
import type { MatchPlayer } from '../match-players'
import { PlayerNumbers } from '../PlayerNumbers'
import { movementRows } from './movement-rows'

type MovementTableProps = { players: MatchPlayer[]; selectedSlot: number; onSelect: (slot: number) => void }

/**
 * The movement counts in two tables side by side, built like the players' numbers beside the replay: a column per
 * player, so a row reads across without hunting for the numbers.
 */
export function MovementTable({ players, selectedSlot, onSelect }: MovementTableProps) {
  const picking = { players, selectedSlot, onSelect }
  const half = Math.ceil(movementRows.length / 2)

  return (
    <section aria-labelledby="movement">
      <h2 id="movement" className={sectionTitle}>
        Movement
      </h2>
      <div className="mt-1 grid gap-x-14 gap-y-2 sm:grid-cols-2">
        <PlayerNumbers rows={movementRows.slice(0, half)} {...picking} />
        <PlayerNumbers rows={movementRows.slice(half)} {...picking} />
      </div>
    </section>
  )
}
