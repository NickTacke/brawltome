import { parseEntityId } from '../../lib'

export type SearchTarget = { kind: 'player' | 'guild'; id: number }

const shortestQueryLength = 2

/** The text worth sending to search, or null while it is too short to match anything useful. */
export function searchTerm(query: string): string | null {
  const term = query.trim()

  return term.length >= shortestQueryLength ? term : null
}

/** What Enter opens: the highlighted result, else the player whose Brawlhalla id was typed. */
export function enterTarget(query: string, highlighted: SearchTarget | undefined): SearchTarget | null {
  if (highlighted) return highlighted

  const playerId = parseEntityId(query.trim())

  if (playerId === null) return null

  return { kind: 'player', id: playerId }
}

/** The result an arrow key moves to, wrapping past either end. -1 means nothing is highlighted. */
export function movedIndex(currentIndex: number, step: 1 | -1, resultCount: number): number {
  if (resultCount === 0) return -1

  // from nothing highlighted, up should land on the last result rather than the one before it
  const startIndex = currentIndex === -1 && step === -1 ? 0 : currentIndex

  return (startIndex + step + resultCount) % resultCount
}
