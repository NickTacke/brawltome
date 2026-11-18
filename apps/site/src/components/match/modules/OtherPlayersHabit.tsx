import { LegendMark } from '../LegendMark'
import { formatShare } from '../match-format'
import type { MatchPlayer } from '../match-players'
import { sampleText } from './habit-text'

type OtherPlayersHabitProps = { habitKey: string; players: MatchPlayer[]; selectedSlot: number }

/**
 * The same habit for everyone else: who, over how much, and under it their pick and its share, each on its own line
 * so nothing is cut short.
 */
export function OtherPlayersHabit({ habitKey, players, selectedSlot }: OtherPlayersHabitProps) {
  const others = players.filter((matchPlayer) => matchPlayer.slot !== selectedSlot)

  return (
    <div className="min-w-0 space-y-2">
      {others.map(({ slot, player, insight }) => {
        const habit = insight.habits.find((entry) => entry.key === habitKey)

        if (!habit) return null

        return (
          <div key={slot} className="flex min-w-0 items-center gap-3">
            <LegendMark player={player} slot={slot} className="size-8 rounded-md" isDecorative />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-xs text-soft">
                <span className="truncate font-semibold">{player.name}</span>
                <span className="shrink-0 font-mono">{sampleText(habit)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm text-strong">
                <span className="truncate font-semibold">{habit.top?.label ?? 'Never came up'}</span>
                <span className="shrink-0 font-bold tabular-nums">{formatShare(habit.share)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
