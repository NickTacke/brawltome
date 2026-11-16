import type { PlayerHead } from './overlay-view'

// what the results screen says about the match just played; the game's memory is the only source
export type PostMatchView = {
  isWin: boolean
  // one opponent in a 1v1, two in a 2v2
  opponents: PlayerHead[]
  // the player's tier after the match, and whether the match moved it
  tier: string | null
  tierChange: 'up' | 'down' | null
  // the 1v1 elo, or the team's elo in a 2v2
  rating: number
  ratingChange: number
  personal2v2: { rating: number; change: number } | null
  // the replay on its way to a match page; null until the app uploads replays
  matchPage: MatchPageState | null
}

export type MatchPageState = 'uploading' | 'building' | 'ready'

// a minus sign, not a hyphen, so a loss lines up with a gain
export function signedChange(change: number): string {
  return change < 0 ? `−${Math.abs(change)}` : `+${change}`
}
