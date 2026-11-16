import { legendAvatarUrl } from '../../guild/legend-avatar-url'
import { formatShare } from '../match-format'
import { cardCaption } from './habit-text'
import type { HabitVersus } from './habit-versus'

/** The hover card of a habit set against the other players: each one's pick, how often, and what it cost them. */
export function HabitVersusCard({ versus }: { versus: HabitVersus }) {
  return (
    <>
      <div className="font-bold text-strong">{versus.situation}</div>
      <div className="mt-2 divide-y divide-line/30">
        {versus.lines.map(({ matchPlayer, habit }, index) => (
          <div key={matchPlayer.slot} className="py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <img
                src={legendAvatarUrl(matchPlayer.player.legendKey)}
                alt=""
                className="size-5 shrink-0 rounded-sm bg-raised object-cover object-top"
              />
              <span className={`min-w-0 flex-1 truncate font-semibold ${index === 0 ? 'text-strong' : 'text-text'}`}>
                {habit.top?.label ?? 'Never came up'}
              </span>
              <span className="font-black tracking-tight text-strong tabular-nums">
                {habit.total > 0 ? formatShare(habit.share) : '–'}
              </span>
            </div>
            <div className="mt-0.5 flex gap-1 pl-7 text-xs whitespace-nowrap text-soft">
              <span className="min-w-0 truncate">{matchPlayer.player.name}</span>
              <span>· {cardCaption(habit)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
