export function formatChange(change: number): string {
  return change > 0 ? `+${change}` : String(change)
}

// the same green and red the player page uses for rating changes
export function changeColour(change: number): string {
  if (change > 0) return 'text-emerald-400'

  return change < 0 ? 'text-red-400' : 'text-soft'
}

/** Whose row this is: a fixed 2v2 entry is a team, every other bracket lists players. */
export function rowNoun(mode: string): string {
  return mode === '2v2' ? 'teams' : 'players'
}
