import { useState } from 'react'
import { FilterSelect } from '../../FilterSelect'
import { sectionTitle } from '../../player/player-styles'
import { TileGrid } from '../../player/TileGrid'
import type { MatchPlayer } from '../match-players'
import { HabitDetail } from './HabitDetail'
import { HabitTile } from './HabitTile'
import { HabitVersusCard } from './HabitVersusCard'
import { readHabitVersus, type VersusSortKey, versusSortOptions } from './habit-versus'
import { insetTiles } from './module-styles'

const tileRem = 12.5
// with four players a tile is four lines tall, so one row shows until the grid is opened; two players get three
// rows, which is every habit but the odd one out on most screens
const teamRows = 1
const duelRows = 3

function ToWatch({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <span className="text-[0.8125rem] whitespace-nowrap text-soft tabular-nums">
      <span className="font-black text-amber-300">{count}</span> to watch
    </span>
  )
}

type PlayerHabitsProps = { matchPlayer: MatchPlayer; players: MatchPlayer[]; durationMs: number }

/** Every player's own habit in each situation, the picked player first, so a different pick stands out. */
export function PlayerHabits({ matchPlayer, players, durationMs }: PlayerHabitsProps) {
  const [sort, setSort] = useState<VersusSortKey>('watch')
  const habits = readHabitVersus(matchPlayer, players, sort)
  const flagged = habits.filter((versus) => versus.own.isFlagged).length

  return (
    <section aria-labelledby="habits">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 id="habits" className={sectionTitle}>
            Habits
          </h2>
          <ToWatch count={flagged} />
        </div>
        <FilterSelect
          label="Sort"
          value={sort}
          options={versusSortOptions}
          onChange={(value) => setSort(value as VersusSortKey)}
        />
      </div>
      <div className={`mt-2 ${insetTiles}`}>
        <TileGrid
          key={matchPlayer.slot}
          items={habits}
          keyOf={(versus) => versus.key}
          labelOf={(versus) => versus.situation}
          minimumTileRem={tileRem}
          collapsedRows={players.length > 2 ? teamRows : duelRows}
          renderTile={(versus, isSelected) => <HabitTile versus={versus} isSelected={isSelected} />}
          renderCard={(versus) => <HabitVersusCard versus={versus} />}
          renderDetail={(versus, close) => (
            <HabitDetail
              habit={versus.own}
              players={players}
              selectedSlot={matchPlayer.slot}
              durationMs={durationMs}
              onClose={close}
            />
          )}
        />
      </div>
    </section>
  )
}
