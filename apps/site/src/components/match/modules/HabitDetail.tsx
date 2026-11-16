import type { Habit } from '@brawltome/contracts'
import type { MatchPlayer } from '../match-players'
import { DetailHeader } from './DetailHeader'
import { DirectionPad } from './DirectionPad'
import { HabitMomentStrip } from './HabitMomentStrip'
import { HabitOptionRows } from './HabitOptionRows'
import { accentOf, costText, damageText, sampleText } from './habit-text'
import { OtherPlayersHabit } from './OtherPlayersHabit'

type HabitDetailProps = {
  habit: Habit
  players: MatchPlayer[]
  selectedSlot: number
  durationMs: number
  onClose: () => void
}

// the others' picks stand beside the options once the panel is wide enough for the option table's columns, and the
// dodge pad's beside them too; on a narrower panel they go underneath
const besideOptions = '@[40rem]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]'
const besidePadAndOptions = '@[52rem]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]'

/** A habit opened up: every option the picked player chose, the others' picks beside it, and when it came up. */
export function HabitDetail({ habit, players, selectedSlot, durationMs, onClose }: HabitDetailProps) {
  const columns = habit.layout === 'pad' ? besidePadAndOptions : besideOptions

  return (
    <div className="@container space-y-4">
      <DetailHeader
        title={habit.situation}
        note={`${sampleText(habit)} · ${costText(habit)} · ${damageText(habit)}`}
        onClose={onClose}
      />
      <div className={`grid gap-x-10 gap-y-4 ${columns}`}>
        <div className="flex min-w-0 items-start gap-6 max-sm:flex-col max-sm:gap-4">
          {habit.layout === 'pad' && <DirectionPad habit={habit} accent={accentOf(habit).colour} />}
          <div className="min-w-0 flex-1">
            <HabitOptionRows habit={habit} />
          </div>
        </div>
        <OtherPlayersHabit habitKey={habit.key} players={players} selectedSlot={selectedSlot} />
      </div>
      <HabitMomentStrip habit={habit} durationMs={durationMs} />
    </div>
  )
}
