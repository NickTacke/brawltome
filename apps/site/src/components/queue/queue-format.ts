export function formatChange(change: number): string {
  return change > 0 ? `+${change}` : String(change)
}

// only gains get a colour, a drop stays quiet rather than turning the list red
export function changeColour(change: number): string {
  return change > 0 ? 'text-win' : 'text-soft'
}

/** Whose row this is: a fixed 2v2 entry is a team, every other bracket lists players. */
export function rowNoun(mode: string): string {
  return mode === '2v2' ? 'teams' : 'players'
}
