import { statLabel } from '../../player/player-styles'
import { LegendMark } from '../LegendMark'
import { formatShare } from '../match-format'
import { accentOf, isThin } from './habit-text'
import type { HabitLine, HabitVersus } from './habit-versus'
import { OptionBar } from './OptionBar'

type LineProps = { line: HabitLine; isOwn: boolean; ownPick: string | undefined }

// one player's own pick in the situation; a pick that differs from the picked player's is the one to notice
function Line({ line, isOwn, ownPick }: LineProps) {
  const { habit, matchPlayer } = line
  const isFaint = isThin(habit)
  const quiet = { text: isFaint ? 'text-soft' : 'text-text', bar: isFaint ? 'bg-soft/40' : 'bg-soft/70' }
  const accent = isOwn ? accentOf(habit) : quiet
  const pickStyle = isOwn || habit.top?.key !== ownPick ? 'text-text' : 'text-soft'

  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-2">
        <LegendMark player={matchPlayer.player} slot={matchPlayer.slot} className="size-5 rounded-sm" />
        <span className={`w-11 shrink-0 text-base leading-none font-black tracking-tight tabular-nums ${accent.text}`}>
          {habit.total > 0 ? formatShare(habit.share) : '–'}
        </span>
        <span className={`min-w-0 truncate text-sm font-bold ${pickStyle}`}>{habit.top?.label ?? 'Never came up'}</span>
      </span>
      <span className="mt-1.5 block">
        <OptionBar habit={habit} accentClass={accent.bar} />
      </span>
    </span>
  )
}

/** A situation with every player's own pick in it, the picked player first. */
export function HabitTile({ versus, isSelected }: { versus: HabitVersus; isSelected: boolean }) {
  const selectedStyle = isSelected ? 'bg-white/[0.05] ring-2 ring-primary' : ''

  return (
    <span className={`block rounded-md px-3 py-2 transition-colors group-hover:bg-white/[0.04] ${selectedStyle}`}>
      <span className={`block truncate ${statLabel}`}>{versus.situation}</span>
      <span className="mt-2 block space-y-2">
        {versus.lines.map((line, index) => (
          <Line key={line.matchPlayer.slot} line={line} isOwn={index === 0} ownPick={versus.own.top?.key} />
        ))}
      </span>
    </span>
  )
}
