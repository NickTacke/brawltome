import type { Habit } from '@brawltome/contracts'
import type { MatchPlayer } from '../match-players'

// one habit for every player of the match: the picked player first, then their teammate, then the opponents

export type HabitLine = { matchPlayer: MatchPlayer; habit: Habit }

export type HabitVersus = { key: string; situation: string; own: Habit; lines: HabitLine[] }

export type VersusSortKey = 'watch' | 'differs' | 'share' | 'cost' | 'times'

export const versusSortOptions: { value: VersusSortKey; label: string }[] = [
  { value: 'watch', label: 'To watch' },
  { value: 'differs', label: 'Most different' },
  { value: 'share', label: 'Share' },
  { value: 'cost', label: 'Cost' },
  { value: 'times', label: 'Times' },
]

function orderFor(picked: MatchPlayer, players: MatchPlayer[]): MatchPlayer[] {
  const rank = (other: MatchPlayer) => {
    if (other.slot === picked.slot) return 0

    return other.player.side === picked.player.side ? 1 : 2
  }

  return [...players].sort((left, right) => rank(left) - rank(right))
}

// how far the others' share of the picked player's pick is from the picked player's own
function difference({ own, lines }: HabitVersus): number {
  const others = lines.slice(1).map(({ habit }) => {
    const samePick = habit.options.find((option) => option.key === own.top?.key)

    return habit.total > 0 ? (samePick?.count ?? 0) / habit.total : own.share
  })

  return Math.max(0, ...others.map((share) => Math.abs(share - own.share)))
}

const scores: Record<VersusSortKey, (versus: HabitVersus) => number> = {
  // habits to watch first; the sort is stable, so the rest keep the insights' order
  watch: ({ own }) => (own.isFlagged ? 1 : 0),
  differs: difference,
  share: ({ own }) => own.share,
  cost: ({ own }) => own.costDamage,
  times: ({ own }) => (own.unit === 'times' ? own.total : 0),
}

/** Each of the picked player's habits with everyone's own pick in the same situation. */
export function readHabitVersus(picked: MatchPlayer, players: MatchPlayer[], sort: VersusSortKey): HabitVersus[] {
  const ordered = orderFor(picked, players)

  const all = picked.insight.habits.map((own): HabitVersus => {
    const lines = ordered.flatMap((matchPlayer): HabitLine[] => {
      const habit = matchPlayer.insight.habits.find((entry) => entry.key === own.key)

      return habit ? [{ matchPlayer, habit }] : []
    })

    return { key: own.key, situation: own.situation, own, lines }
  })

  return [...all].sort((left, right) => scores[sort](right) - scores[sort](left))
}
